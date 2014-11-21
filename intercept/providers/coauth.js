(function (angular) {
    'use strict';

    var iframeHidden = '<iframe class="qp-frame qp-background" frameborder="0" allowtransparency="true" seamless sandbox="allow-popups allow-same-origin allow-scripts allow-forms"></iframe>',
        iframeBanner = '"background-color: transparent; border: 0px none transparent; overflow: hidden; visibility: visible; margin: 0px; padding: 0px; ' +
                            '-webkit-tap-highlight-color: transparent; position: fixed; left: 0px; top: 0px; width: 100%; height: 100%; z-index: 9999; display: block;"';

    angular.module('OAuth').

        

        factory('authDirected', ['$rootScope','$timeout', 'authPopup', function ($rootScope, $timeout, authPopup) {
            return function (uri, iframe, reason, provider) {
                if (provider !== undefined) {
                    var host = uri.substr(0, uri.indexOf('/', 8));  // gets the hostname including the http:// \ https:// (hence start at char 8)
                    iframe.attr('style', 'display:none').attr('src', host + '/auth/' + provider).on('load', function(event) {
                        if ($rootScope.directedTimeout !== undefined) {
                            $timeout.cancel($rootScope.directedTimeout);
                            $rootScope.directedTimeout = undefined;
                        }
                        window.location = host + '/auth/login?provider=' + provider + '&continue=' + encodeURIComponent(window.location.href);
                    });
                } else {
                    authPopup(uri, iframe);
                }
            };
        }]).

        factory('authPopup', [function () {
            return function (uri, iframe) {
                var host = uri.substr(0, uri.indexOf('/', 8));  // gets the hostname including the http:// \ https:// (hence start at char 8)
                iframe.attr('style', iframeBanner).attr('src', host + '/login-banner');
            };
        }]).

        factory('authCC', [function () {
            return function (uri, iframe) {
                var host = uri.substr(0, uri.indexOf('/', 8));  // gets the hostname including the http:// \ https:// (hence start at char 8)

                iframe.attr('style', iframeBanner).attr('src', host + '/cc-banner');
            };
        }]).

        directive('coAuth', ['$window', '$timeout', '$injector', '$rootScope', function ($window, $timeout, $injector, $rootScope) {
            var elWindow = angular.element($window),
                origin = $window.location.protocol + '//' + $window.location.hostname;

            if ($window.location.port !== '') {
                origin += ':' + $window.location.port;
            }

            return {
                restrict: 'A',
                replace: false,
                scope: {
                    provider: '@',
                    loginType: '@'
                },
                link: function (scope, element) {
                    var iframe,    // Holds the iframe element being used for the request
                        handler,   // Holds the remote window handler
                        timeout,   // Holds the timeout for a response from the iframe
                        dirLogin = element.attr('login') || $rootScope.directedLogin,
                        loginService = $injector.get('auth' + scope.loginType),
                        cleanUp = function () {
                            // remove any existing elements auth attempts
                            if (iframe) {
                                iframe.remove();
                                iframe = undefined;
                            }
                            if (handler) {
                                elWindow.unbind('message', handler);
                                handler = undefined;
                            }

                            if ($rootScope.directedPopup !== undefined) {
                                if (!$rootScope.directedPopup.closed) {
                                    $rootScope.directedPopup.close();
                                }
                                $rootScope.directedPopup = undefined;
                            }
                        };

                    scope.$on('$comms.authenticate', function (event, id, uri, deferred, tokenOnly) {
                        // Check the request is for us
                        if (id === scope.provider) {
                            scope.$emit('$comms.servicing', 'authenticate');

                            cleanUp();

                            // create the request using an iframe
                            iframe = angular
                                .element(iframeHidden)
                                .attr('src', uri);

                                element.append(iframe);

                            // iframe or pop-up uses this to communicate with us
                            // curries in request variables
                            handler = function (message) {
                                message = message.originalEvent || message;
                                if (message.source === iframe[0].contentWindow || message.source === $rootScope.directedPopup) {
                                    if (timeout !== undefined) {
                                        $timeout.cancel(timeout);
                                        timeout = undefined;
                                    }

                                    if ($rootScope.directedTimeout !== undefined) {
                                        $timeout.cancel($rootScope.directedTimeout);
                                        $rootScope.directedTimeout = undefined;
                                    }

                                    switch (message.data) {
                                    case 'login':
                                        if (tokenOnly) {
                                            cleanUp();
                                            scope.$apply(function () {
                                                deferred.reject('login required');
                                            });
                                        } else {
                                            loginService(uri, iframe, message.data, dirLogin);
                                        }
                                        break;
                                    case 'cancel':
                                        cleanUp();
                                        scope.$apply(function () {
                                            deferred.reject('cancel');
                                        });
                                        break;
                                    case 'error':
                                        if (tokenOnly) {
                                            cleanUp();
                                            scope.$apply(function () {
                                                deferred.reject('login required');
                                            });
                                        } else {
                                            loginService(uri, iframe, message.data, dirLogin);
                                        }
                                        break;
                                    case 'retry':
                                        // back to token URI
                                        iframe.removeAttr('style').attr('src', uri);
                                        break;
                                    default:
                                        if (message.origin === origin) {
                                            cleanUp();
                                            scope.$apply(function () {
                                                deferred.resolve(JSON.parse(message.data));
                                            });
                                        }
                                    }
                                }
                            };
                            elWindow.bind('message', handler);
                            timeout = $timeout(function () {
                                timeout = undefined;
                                loginService(uri, iframe, 'timeout', dirLogin);
                            }, 30000, false);    // don't invoke apply
                        }
                    });

                    scope.$on('$comms.authenticated', function (event, id) {
                        if (id === scope.provider) {
                            cleanUp();
                        }
                    });

                    scope.$on('$destroy', function () {
                        cleanUp();
                    });
                }
            };
        }]);

}(this.angular));
