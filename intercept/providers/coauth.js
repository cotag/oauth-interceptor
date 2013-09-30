
(function (angular) {
    'use strict';

    angular.module('OAuth').

        directive('coAuth', ['$window', '$timeout', function ($window, $timeout) {
            var elWindow = angular.element($window),
                origin = $window.location.protocol + '//' + $window.location.hostname + ':' + ($window.location.port === '' ? 80 : $window.location.port);

            return {
                restrict: 'A',
                replace: false,
                scope: {
                    providerId: '@'
                },
                template:
                    '<div data-ng-show="login_required == true" >' +     // fix data-ng-animate="' + "'fade'" +  '"
                        '<div>' + // banner
                        '<div class="limit-width">' + // max width
                            '<img src="" />' + //logo 
                            '<div class="text">Please login to continue</div>' +
                            '<button type="button" data-ng-click="showLoginWindow($event)" class="login-ok">Login</button> <span data-ng-click="hideLoginRequest()" class="cancel">cancel</span> ' +
                        '</div>' +
                        '<div>' +
                    '</div>',
                link: function (scope, element) {
                    var iframe,    // Holds the iframe element being used for the request
                        handler,   // Holds the remote window handler
                        timeout,   // Holds the timeout for a response from the iframe
                        popup,     // The pop-up reference
                        overlay = element.children('div'),   // The modal overlay
                        banner = overlay.children('div'),    // The login required message
                        position_banner = function () {
                            banner.css({
                                'margin-top': (elWindow.height() / 2) - (banner.height() / 2) + 'px'
                            });
                        },
                        cleanUp = function () {
                            // remove any existing elements auth attempts
                            if (iframe) {
                                iframe.remove();
                                iframe = undefined;
                            } else if (popup) {
                                if (!popup.closed) {
                                    popup.close();
                                }
                                popup = undefined;
                            }
                            if (handler) {
                                elWindow.unbind('message', handler);
                                handler = undefined;
                            }
                            elWindow.unbind('resize', position_banner);    // just in case we are binding to this
                            elWindow.unbind('orientationchange', position_banner);
                        },
                        requestLogin = function (id, uri, deferred) {
                            iframe.remove();
                            iframe = undefined;

                            elWindow.bind('resize orientationchange', position_banner);
                            position_banner();

                            scope.hideLoginRequest = function () {
                                cleanUp();
                                scope.login_required = false;
                                deferred.reject('cancel');
                            };

                            scope.$apply(function () {
                                scope.login_required = true;
                                scope.showLoginWindow = function () {
                                    var w = Math.max(400, $window.screen.width / 2),
                                        h = Math.max(400, $window.screen.height / 2),
                                        left = Number(($window.screen.width / 2) - (w / 2)),
                                        top = Number(($window.screen.height / 2) - (h / 2));

                                    if (popup && !popup.closed) {
                                        popup.close();
                                    }
                                    popup = $window.open(uri, id, 'toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes,resizable=yes,copyhistory=no,width=' + w + ',height=' + h + ',top=' + top + ',left=' + left);
                                };
                            });
                        };

                    scope.login_required = false;

                    scope.$on('$comms.authenticate', function (event, id, uri, deferred) {
                        // Check the request is for us
                        if (id === scope.providerId) {
                            scope.$emit('$comms.servicing', 'authenticate');

                            cleanUp();

                            // create the request using an iframe
                            iframe = angular
                                .element('<iframe class="core-auth" frameborder="0" seamless sandbox="allow-scripts allow-forms"></iframe>')
                                .attr('src', uri).appendTo(element);

                            // iframe or pop-up uses this to communicate with us
                            // curries in request variables
                            handler = function (message) {
                                message = message.originalEvent || message;
                                if (message.source === popup || message.source === iframe[0].contentWindow) {
                                    $timeout.cancel(timeout);
                                    timeout = undefined;

                                    switch (message.data) {
                                    case 'login':
                                        if (!popup || popup.closed) {
                                            // user action required, we should display the login in a new window
                                            requestLogin(id, uri, deferred);
                                        }
                                        break;
                                    case 'confirm':
                                        if (iframe) {
                                            // no secret data, we'll use an iframe for this
                                            iframe.addClass('show');
                                        }
                                        break;
                                    case 'cancel':    // NOTE:: We want to fall through here
                                    case 'error':
                                    case '':         // NOTE:: IE less then 10 can't use postMessage on pop-ups (without triggering this)
                                        // Inform comms that we don't want to go ahead with this
                                        //    Popup we want to leave open
                                        if (iframe) {
                                            if (message.data === 'cancel') {
                                                cleanUp();
                                                scope.$apply(function () {
                                                    deferred.reject('cancel');
                                                });
                                            } else {
                                                requestLogin(id, uri, deferred);
                                            }
                                        } else if (popup && !popup.closed) {
                                            popup.close();    // The user can then open a new popup if desirable
                                        }
                                        break;
                                    default:
                                        if (message.origin === origin || message.origin === 'null') {
                                            cleanUp();
                                            scope.$apply(function () {
                                                deferred.resolve(angular.element.parseJSON(message.data));
                                            });
                                        }
                                    }
                                }
                            };
                            elWindow.bind('message', handler);
                            timeout = $timeout(function () {
                                timeout = undefined;
                                requestLogin(id, uri, deferred);
                            }, 5000, false);    // don't invoke apply
                        }
                    });

                    scope.$on('$comms.authenticated', function (event, id) {
                        if (id === scope.providerId) {
                            cleanUp();
                            scope.login_required = false;
                        }
                    });

                    scope.$on('$destroy', function () {
                        cleanUp();
                        if ($window.provide_alt_postMessage) {
                            delete $window.quaypay_postMessage;
                        }
                    });

                    // Hack for IE less then 10 to support post message on popups
                    if ($window.provide_alt_postMessage) {
                        $window.quaypay_postMessage = function (message, popuporigin, source) {
                            if (handler) {
                                handler({
                                    data: message,
                                    origin: popuporigin,
                                    source: source
                                });
                            }
                        };
                    }
                }
            };
        }]);

}(this.angular));
