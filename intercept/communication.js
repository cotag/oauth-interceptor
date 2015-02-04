/**
*    Core communication and authentication library
*    Used to retry failed comms and authenticate against oauth 2 providers
*    
*   Copyright (c) 2013 QuayPay.
*    
*    @author     Stephen von Takach <steve@quaypay.com>
*    @copyright  2013 quaypay.com
* 
*     
*     References:
*        * https://raw.github.com/timdream/wordcloud/master/go2.js
*         * https://github.com/witoldsz/angular-http-auth
*         ** http://www.espeo.pl/2012/02/26/authentication-in-angularjs-application
*         * http://nils-blum-oeste.net/cors-api-with-oauth2-authentication-using-rails-and-angularjs/#.UPTqHiesh8F
*         * https://developers.facebook.com/docs/reference/dialogs/oauth/
*
**/

(function (angular, window) {
    'use strict';


    var module = angular.module('OAuth', []);

    // Global container for the iframe
    var container = document.createElement('div'),
        iframeHidden = '<iframe sandbox="allow-scripts allow-same-origin"></iframe>',
        origin = window.location.protocol + '//' + window.location.hostname,
        elWindow = angular.element(window);

    container = angular.element(container);
    container.attr('id', 'coauth');
    container.attr('style', 'width: 1px; height: 1px;');
    angular.element(document.body).append(container);


    if (window.location.port !== '') {
        origin += ':' + window.location.port;
    }


    module
    .provider('$comms', ['$httpProvider', function ($httpProvider) {
        var endpoint,           // List of configured service endpoints
            config,             // Current state for each service
            ignore_list = {},   // List of URI's we don't want to retry

            // These functions to be provided by the service
            retryRequest = angular.noop,
            authenticate = angular.noop,

            // This is the current state
            authenticating = null,
            authenticated = false,
            authenticated_at = 0,
            access_token,
            request_buffer = [],
            request_retry = [];



        // Add arguments to the URI ignore list
        this.ignore = function () {
            var i;
            for (i = 0; i < arguments.length; i += 1) {
                ignore_list[arguments[i]] = 0;
            }
        };


        // Add services we need to be authenticated for
        // Required options:
        //  id (e.g. quaypay store)
        //  scope (optional)
        //  proactive (optional)
        //  oauth_server
        //  redirect_uri
        //  client_id
        //  api_endpoint
        //
        //  access_timeout (set by response)
        //  access_token (set by response - timer reference)
        //  waiting_for_token
        this.service = function (options) {
            var regex = new RegExp(options.api_endpoint, '');
            endpoint = regex;        // Speeds up matching later
            config = options;
        };


        //
        // Inject authorization tokens when required and provide retry functionality for requests
        //    This way we can attempt to login and retry any unauthorized or failed requests
        //
        $httpProvider.interceptors.push([
            '$q',
        function ($q) {
            return {
                // Ensure the access token is attached to API requests
                request: function (request) {
                    if (request.url.match(endpoint)) {
                        if (authenticated) {
                            request.sent_at = Date.now();
                            request.headers.Authorization = 'Bearer ' + access_token;

                        } else if (!config.when_prompted || request_buffer.length > 0) {
                            var deferred = $q.defer();

                            // We save the request and instead request a token
                            request_buffer.push({
                                request: request,
                                deferred: deferred
                            });

                            if (!authenticating) {
                                authenticate();
                            }

                            return deferred.promise;
                        }
                    }

                    return request;
                },

                responseError: function (response) {
                    // Check if failures to the URL are to be ignored
                    if (
                        response.status == 401 && 
                        ignore_list[response.config.url] === undefined &&
                        response.config.url.match(endpoint)
                    ) {
                        var deferred = $q.defer();

                        if (authenticated_at > response.config.sent_at) {
                            // retry request if auth occured after the request was made
                            retryRequest(response.config, deferred);

                        } else {
                            request_retry.push({
                                response: response,
                                deferred: deferred
                            });

                            if (!authenticating) {
                                authenticate();
                            }
                        }

                        return deferred.promise;    // no need to break;
                    }

                    // Otherwise continue the rejection
                    return $q.reject(response);
                }
            };
        }]);


        // The factory method
        this.$get = [
            '$window',
            '$q',
            '$timeout',
            '$http',
            '$rootScope',
            '$location',
        function ($window, $q, $timeout, $http, scope, $location) {

            var api = {},
                expired_timeout,
                tokenNotifier = $q.defer(),
                authComplete = function (token, expires, noSave) {
                    var buffered = request_buffer,
                        do_retry = request_retry;

                    request_buffer = [];
                    request_retry = [];

                    authenticated_at = Date.now();
                    authenticating = null;
                    authenticated = true;
                    access_token = token;

                    if (!noSave) {
                        localStorage.setItem('accessToken', token);
                        localStorage.setItem('accessExpiry', expires);
                    }

                    if (expired_timeout) {
                        $timeout.cancel(expired_timeout);
                    }
                    expired_timeout = $timeout(function () {
                        authenticated = false;
                        authenticate();
                    }, (expires - 1) * 1000);

                    angular.forEach(buffered, function (req) {
                        var request = req.request;
                        request.sent_at = Date.now();
                        request.headers.Authorization = 'Bearer ' + access_token;

                        req.deferred.resolve(request);
                        //retryRequest(req.request, req.deferred);
                    });

                    angular.forEach(do_retry, function (res) {
                        retryRequest(res.response.config, res.deferred);
                    });

                    tokenNotifier.notify(access_token);
                    scope.$broadcast('$comms.authenticated', access_token);
                },
                refreshRequest = function (code) {
                    var options = {
                            client_id: config.client_id,
                            redirect_uri: config.redirect_uri
                        },
                        performPost = function () {
                            return $http.post(config.oauth_tokens, options, {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Accept': 'application/json'
                                }
                            }).then(function (success) {
                                success = success.data;

                                // setRefreshTokenMark
                                localStorage.setItem('refreshToken', success.refresh_token);
    
                                // Place the access code in the system
                                authComplete(success.access_token, success.expires_in);

                                return success.access_token;
                            }, function (error) {
                                // Refresh token is no more
                                // 404 == couchbase error, 500 == other and we should ignore
                                if (error.status == 400 || error.status == 401) {
                                    localStorage.removeItem('refreshToken');
                                    return requestToken();
                                }

                                // Failure here means we should start again.
                                window.setTimeout(function() {
                                    location.reload();
                                }, 2000);

                                // Hang the promise chain
                                return $q.defer().promise;
                            });
                        };

                    if (code === undefined) {
                        options.grant_type = 'refresh_token';
                        options.refresh_token = localStorage.getItem('refreshToken');
                        return performPost();
                    }
                    
                    options.grant_type = 'authorization_code';
                    options.code = code;
                    return performPost();
                },
                iframeRequest = function (url, deferred) {
                    var iframe = angular
                            .element(iframeHidden)
                            .attr('src', url),

                        handler,
                        timeout,

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
                        };

                    container.append(iframe);

                    // iframe or pop-up uses this to communicate with us
                    // curries in request variables
                    handler = function (message) {
                        message = message.originalEvent || message;
                        if (message.source === iframe[0].contentWindow) {
                            if (timeout) {
                                $timeout.cancel(timeout);
                                timeout = null;
                            }

                            switch (message.data) {
                            case 'login':
                            case 'cancel':
                            case 'error':
                                cleanUp();
                                scope.$apply(function () {
                                    deferred.reject(message.data);
                                });
                                break;
                            case 'retry':
                                // Lets request that again
                                iframe.removeAttr('src').attr('src', url);
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
                        timeout = null;
                        cleanUp();
                        deferred.reject('timeout');
                    }, 30000);
                },
                requestToken = function (type) {
                    var deferred,
                        request,
                        token = localStorage.getItem('refreshToken');

                    // Use refresh tokens when available
                    if (config.oauth_tokens && (token || $location.search().trust) && type !== 'code') {
                        if (token) {
                            return refreshRequest();
                        }

                        return requestToken('code').then(function (code) {
                            // Use the grant code to request a refresh token
                            return refreshRequest(code.code);
                        });
                    }

                    // set the defaults
                    type = type || 'token';

                    // Build the request
                    deferred = $q.defer();
                    request = config.oauth_server + '?response_type=' + type +
                                '&redirect_uri=' + encodeURIComponent(config.redirect_uri) +
                                '&client_id=' + encodeURIComponent(config.client_id);

                    if (config.scope) {
                        request += '&scope=' + encodeURIComponent(config.scope);
                    }

                    iframeRequest(request, deferred);

                    return deferred.promise.then(function (tokenResp) {
                        if (type === 'code') {
                            return refreshRequest(tokenResp.code);
                        }

                        authComplete(tokenResp.token, tokenResp.expires_in);
                        return tokenResp.token;
                    }, function (failed) {
                        // Fail all existing requests
                        var requests = request_buffer,
                            retries = request_retry;
                        request_buffer = [];
                        request_retry = [];

                        authenticating = null;
                        authenticated = false;
                        access_token = null;

                        angular.forEach(requests, function (req) {
                            req.deferred.reject(failed);
                        });

                        // Fail with the original failure
                        angular.forEach(retries, function (res) {
                            req.deferred.reject(res.response);
                        });

                        return $q.reject(failed);
                    });
                },

                tempExpires = localStorage.getItem('accessExpiry');



            // Attempt to load any existing tokens from the cache
            access_token = localStorage.getItem('accessToken');
            if (tempExpires && access_token) {
                authComplete(access_token, tempExpires, true);
            }


            // These are accessed by the interceptors
            retryRequest = function (request, deferred) {
                deferred.resolve($http(request));
            };

            authenticate = function (type, do_login) {
                if (authenticating) { return authenticating; }

                if (expired_timeout) {
                    $timeout.cancel(expired_timeout);
                    expired_timeout = null;
                }

                authenticated = false;
                authenticating = requestToken(type);

                return authenticating.catch(function (reason) {
                    if ((do_login === undefined || do_login) && config.login_redirect && reason === 'login') {
                        $window.location = config.login_redirect();
                        return $q.defer().promise;
                    }

                    // Continue the failure
                    return $q.reject(reason);
                });
            };


            // These are public API calls:
            api.isRemembered = function () {
                !!localStorage.getItem('refreshToken');
            };

            api.rememberMe = function () {
                if (api.isRemembered()) {
                    var deferred = $q.defer();
                    deferred.resolve(true);
                    return deferred.promise;
                }

                if (authenticating) {
                    return authenticating.finally(api.rememberMe);
                }

                return authenticate('code', true);
            };

            // Non-destructive authentication attempt
            api.tryAuth = function (force) {
                if (authenticating) {
                    return authenticating.finally(function () {
                        api.tryAuth(force);
                    });
                }

                var deferred = $q.defer();

                if (authenticated) {
                    deferred.resolve(access_token);
                } else {
                    if (force) {
                        return authenticate(null, true);
                    }

                    deferred.reject(false);
                }

                return deferred.promise;
            };

            api.getToken = function () {
                return api.tryAuth(true);
            };

            api.authenticated = function () {
                return authenticated;
            };

            // Callback on token update
            api.notifier = function (callback) {
                tokenNotifier.promise.then(angular.noop, angular.noop, callback);
            };

            if (config.proactive && !config.when_prompted) {
                authenticate();
            }

            return api;
        }];
    }])

    .run(['$comms', angular.noop]);
}(this.angular, this));

