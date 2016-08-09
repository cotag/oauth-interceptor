(function (angular, window) {
    'use strict';


    var inIframe = function () {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    };


    window.OAuthEndPoint = function (config) {
            var api = this,
                endpoint = new RegExp(config.api_endpoint, ''),           // List of configured service endpoints
                ignore_list = {},   // List of URI's we don't want to retry

                // This is the current state
                authenticating = null,
                authenticated = false,
                authenticated_at = 0,
                access_token,
                request_buffer = [],
                request_retry = [],

                expired_timeout,
                tokenNotifier,


                $window = null,
                $q = null,
                $timeout = null,
                $http = null,
                scope = null,
                $location = null,

                refreshTokenKey = null, // refreshTokenKey
                accessTokenKey = null,  // accessTokenKey
                accessExpiryKey = null, // accessExpiryKey


                // Global container for the iframe
                container = document.createElement('div'),
                iframeHidden = '<iframe sandbox="allow-scripts allow-same-origin"></iframe>',
                origin = window.location.protocol + '//' + window.location.hostname,
                elWindow = angular.element(window),


                inToAt = function (time) {
                    return time * 1000 + Date.now();
                },
                nextTimer = function (expiresAt) {
                    var timerIn = Math.min(expiresAt - Date.now() - 500, 20000);

                    expired_timeout = $timeout(function () {
                        if ((expiresAt - 500) <= Date.now()) {
                            authenticated = false;
                            if (config.proactive && !config.when_prompted) {
                                api.authenticate();
                            }
                        } else {
                            nextTimer(expiresAt);
                        }
                    }, Math.max(timerIn, 0));
                },
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
                        localStorage.setItem(accessTokenKey, token);
                        localStorage.setItem(accessExpiryKey, expires);
                    }

                    if (expired_timeout) {
                        $timeout.cancel(expired_timeout);
                    }
                    nextTimer(expires);

                    angular.forEach(buffered, function (req) {
                        var request = req.request;
                        request.sent_at = Date.now();
                        request.headers.Authorization = 'Bearer ' + access_token;

                        req.deferred.resolve(request);
                        //retryRequest(req.request, req.deferred);
                    });

                    angular.forEach(do_retry, function (res) {
                        api.retryRequest(res.response.config, res.deferred);
                    });

                    // This is effectively next_tick so the page has time to load if
                    // we are loading the tokens from the cache.
                    $timeout(function () {
                        tokenNotifier.notify(access_token);
                        scope.$broadcast('$comms.authenticated', access_token);
                    });
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
                                localStorage.setItem(refreshTokenKey, success.refresh_token);
    
                                // Place the access code in the system
                                authComplete(success.access_token, inToAt(success.expires_in));

                                return success.access_token;
                            }, function (error) {
                                // Refresh token is no more
                                // 404 == couchbase error, 500 == other and we should ignore
                                if (error.status == 400 || error.status == 401) {
                                    localStorage.removeItem(refreshTokenKey);
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
                        options.refresh_token = localStorage.getItem(refreshTokenKey);
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
                        token = localStorage.getItem(refreshTokenKey);

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

                    request += '&time=' + Date.now();
                    iframeRequest(request, deferred);

                    return deferred.promise.then(function (tokenResp) {
                        if (type === 'code') {
                            return refreshRequest(tokenResp.code);
                        }

                        authComplete(tokenResp.token, inToAt(tokenResp.expires_in));
                        return tokenResp.token;
                    }, function (failed) {
                        // Fail all existing requests
                        var requests = request_buffer,
                            retries = request_retry;
                        request_buffer = [];
                        request_retry = [];

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
                };

            
            // Define the keys
            if (config.isolate) {
                refreshTokenKey = config.id + 'refreshToken';
                accessTokenKey = config.id + 'accessToken';
                accessExpiryKey = config.id + 'accessExpiry';
            } else {
                refreshTokenKey = 'refreshToken';
                accessTokenKey = 'accessToken';
                accessExpiryKey = 'accessExpiry';
            }

            // Build the reference to the iframe
            container = angular.element(container);
            container.attr('id', 'coauth');
            container.attr('style', 'width: 1px; height: 1px;');
            angular.element(document.body).append(container);


            if (window.location.port !== '') {
                origin += ':' + window.location.port;
            }


            // These are accessed by the interceptors
            api.retryRequest = function (request, deferred) {
                deferred.resolve($http(request));
            };

            api.uri = function () {
                return endpoint;
            };

            api.authenticated = function () {
                return authenticated;
            };

            api.request_buffer = function () {
                return request_buffer;
            };

            api.request_retry = function () {
                return request_retry;
            };

            api.authenticated_at = function () {
                return authenticated_at;
            };

            api.authenticating = function () {
                return authenticating;
            };

            api.access_token = function () {
                return access_token;
            };

            api.config = function () {
                return config;
            };

            api.authenticate = function (type, do_login) {
                if (authenticating) { return authenticating; }

                if (expired_timeout) {
                    $timeout.cancel(expired_timeout);
                    expired_timeout = null;
                }

                if (inIframe() && !$location.search().forceauth) {
                    var tempExpires,
                        deferred = $q.defer(),
                        getUpdatedToken = function () {
                            access_token = localStorage.getItem(accessTokenKey);
                            tempExpires = localStorage.getItem(accessExpiryKey)

                            if (tempExpires && access_token) {
                                tempExpires = parseInt(tempExpires);

                                if ((tempExpires - 1000) > Date.now()) {
                                    authComplete(access_token, tempExpires, true);
                                    deferred.resolve(access_token);
                                } else {
                                    $timeout(function () {
                                        getUpdatedToken();
                                    }, 100);
                                }
                            } else {
                                console.warn('No token found for page in iFrame. Use forceauth param if this page should authenticate');
                                $timeout(function () {
                                    getUpdatedToken();
                                }, 1000);
                            }
                        };

                    authenticated = false;
                    authenticating = deferred.promise;

                    getUpdatedToken();

                    return authenticating;
                } else {
                    authenticated = false;
                    authenticating = requestToken(type);

                    return authenticating.catch(function (reason) {
                        if ((do_login === undefined || do_login) && config.login_redirect && reason === 'login') {
                            var redirect = config.login_redirect();
                            if (redirect.then) {
                                redirect.then(function (uri) {
                                    $window.location = uri;
                                });
                            } else {
                                $window.location = redirect;
                            }
                            return $q.defer().promise;
                        } else {
                            // Else we want to retry authentication
                            authenticating = null;
                        }

                        // Continue the failure
                        return $q.reject(reason);
                    });
                }
            };


            api.ignore = function () {
                var i;
                for (i = 0; i < arguments.length; i += 1) {
                    ignore_list[arguments[i]] = 0;
                }
            };


            api.onLoad = function (window, q, timeout, http, $scope, location) {
                var tempExpires = localStorage.getItem(accessExpiryKey);


                $window = window;
                $q = q;
                $timeout = timeout
                $http = http;
                scope = $scope;
                $location = location;

                tokenNotifier = $q.defer();


                // Attempt to load any existing tokens from the cache
                access_token = localStorage.getItem(accessTokenKey);
                if (tempExpires && access_token) {
                    tempExpires = parseInt(tempExpires);

                    if ((tempExpires - 1000) > Date.now()) {
                        authComplete(access_token, tempExpires, true);
                    }
                }

                if (config.proactive && !authenticated && !config.when_prompted) {
                    api.authenticate();
                }
            };





            // These are public API calls:
            api.isRemembered = function () {
                !!localStorage.getItem(refreshTokenKey);
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

                return api.authenticate('code', true);
            };

            // Non-destructive authentication attempt
            api.tryAuth = function (force) {
                if (authenticating) {
                    return authenticating;
                }

                var deferred = $q.defer();

                if (authenticated) {
                    deferred.resolve(access_token);
                } else {
                    if (force) {
                        return api.authenticate(null, true);
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

            api.clearAuth = function () {
                localStorage.removeItem(accessTokenKey);
                localStorage.removeItem(accessExpiryKey);
                localStorage.removeItem(refreshTokenKey);
            };

            // Callback on token update
            api.notifier = function (callback) {
                tokenNotifier.promise.then(angular.noop, angular.noop, callback);
            };
        };


}(this.angular, this));