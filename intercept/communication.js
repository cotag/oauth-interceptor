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

(function (angular) {
    'use strict';

    angular.module('OAuth', ['LocalForageModule'])

        .provider('$comms', ['$httpProvider', function ($httpProvider) {
            var api_endpoints = [],      // List of configured service endpoints
                api_configs = {},        // Current state for each service
                ignore_list = {};        // List of URI's we don't want to retry


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
                options.request_buffer = [];

                api_endpoints.push([regex, options.id]);        // Speeds up matching later
                api_configs[options.id] = options;              // id for lookup
            };


            //
            // Inject authorization tokens when required and provide retry functionality for requests
            //    This way we can attempt to login and retry any unauthorized or failed requests
            //
            $httpProvider.interceptors.push([
                '$q',
                '$rootScope',
            function ($q, $rootScope) {
                return {
                    // Ensure the access token is attached to API requests
                    request: function (config) {
                        var i, api_config, deferred;

                        for (i = 0; i < api_endpoints.length; i += 1) {
                            if (config.url.match(api_endpoints[i][0])) {
                                api_config = api_configs[api_endpoints[i][1]];

                                if (api_config.access_token) {
                                    config.headers.Authorization = 'Bearer ' + api_config.access_token;
                                } else if (!api_config.when_prompted) {
                                    // We save the request and instead request a token
                                    deferred = $q.defer();

                                    api_config.request_buffer.push({
                                        config: config,
                                        deferred: deferred,
                                        pending: api_config    // Return config only, don't fulfil the request
                                    });

                                    $rootScope.$emit('$comms.noAuth', api_config);
                                    return deferred.promise;
                                }
                            }
                        }
                        return config;
                    },


                    responseError: function (response) {
                        // Check if failures to the URL are to be ignored
                        if (ignore_list[response.config.url] === undefined) {
                            var i, deferred, api_config;


                            switch (response.status) {

                            // Catch unauthorized responses from the API
                            case 401:
                                for (i = 0; i < api_endpoints.length; i += 1) {
                                    if (response.config.url.match(api_endpoints[i][0])) {
                                        api_config = api_configs[api_endpoints[i][1]];

                                        deferred = $q.defer();

                                        api_config.request_buffer.push({
                                            config: response.config,
                                            deferred: deferred
                                        });

                                        $rootScope.$emit('$comms.noAuth', api_config);
                                        return deferred.promise;    // no need to break;
                                    }
                                }
                                break;

                            // Catch any timeout responses as we can retry these
                            case 408:
                                deferred = $q.defer();

                                $rootScope.$emit('$comms.serviceRetry', response.config, deferred);
                                return deferred.promise;
                                //break; // unreachable
                            }
                        } else {
                            ignore_list[response.config.url] += 1;    // Count the times ignored URIs failed
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
                '$localForage',
            function ($window, $q, $timeout, $http, $rootScope, $storage) {

                var api = {},
                    checkingAuth = {},
                    overrides = {},
                    retry = function (config, deferred) {
                        $http(config)    // Config will be intercepted if this is an API call
                            .success(function (response) {
                                deferred.resolve(response);
                            })
                            .error(function (rejection) {
                                deferred.reject(rejection);
                            });
                    },
                    doRetry = function (config, deferred) {
                        config.retry_count = config.retry_count || -1;
                        config.retry_count += 1;

                        if (config.retry_count === 0) {
                            retry(config, deferred);
                        } else if (config.retry_count >= 5) {
                            deferred.reject('retry limit reached');
                        } else {
                            $timeout(function () {   // Exponentially back off (2 ^ retry_count) + random_number_milliseconds
                                retry(config, deferred);
                            }, $window.Math.pow(2, config.retry_count) * 1000 + $window.Math.floor($window.Math.random() * 1000));
                        }
                    },
                    retryAll = function (buffer) {
                        var request;
                        while (buffer.length > 0) {
                            request = buffer.shift();
                            if (request.pending) {
                                // Request waiting to be sent
                                request.config.headers.Authorization = 'Bearer ' + request.pending.access_token;
                                request.deferred.resolve(request.config);
                            } else {
                                // Retry a failed request due to a lack of authentication
                                //$rootScope.$broadcast('$comms.retry', request.config, request.deferred);
                                doRetry(request.config, request.deferred);
                            }
                        }
                    },
                    applyToken = function (api_config, token, expires) {
                        api_config.access_token = token;
                        api_config.waiting_for_token = false;

                        // Remove the token timeout if it exists
                        if (api_config.access_timeout !== undefined) {
                            $timeout.cancel(api_config.access_timeout);
                        }

                        // Set a new timeout
                        api_config.access_timeout = $timeout(function () {
                            api_config.access_timeout = undefined;
                            api_config.access_token = undefined;
                            $rootScope.$emit('$comms.noAuth', api_config);
                        }, expires * 1000);

                        // Inform listeners that we are authenticated
                        $rootScope.$broadcast('$comms.authenticated', api_config.id);
                        retryAll(api_config.request_buffer);
                    },
                    requestToken = function (api_config, token_only, type) {
                        // set the defaults
                        type = type || 'token';
                        token_only = !!token_only;

                        // One request at a time
                        if (api_config.waiting_for_token) { 
                            return api_config.waiting_for_token; 
                        }

                        // Construct the request
                        var deferred = $q.defer(),
                            request = api_config.oauth_server + '?response_type=' + type
                                        + '&redirect_uri=' + encodeURIComponent(api_config.redirect_uri)
                                        + '&client_id=' + encodeURIComponent(api_config.client_id);

                        if (api_config.scope) {
                            request += '&scope=' + encodeURIComponent(api_config.scope);
                        }

                        // Request authentication for the API (delegating to a directive)
                        overrides.authenticate = false;
                        $rootScope.$broadcast('$comms.authenticate', api_config.id, request, deferred, token_only);

                        if (overrides.authenticate) {
                            // Handle the response
                            api_config.waiting_for_token = 
                                deferred.promise.then(function (success) {
                                    if (type === 'token') {
                                        applyToken(api_config, success.token, success.expires_in);
                                    } else {
                                        api_config.waiting_for_token = false;
                                    }

                                    return success[type];
                                }, function () {     // On Failure
                                    // Failure means that the auth directive is letting the user know of the error
                                    // We should clear pending requests
                                    api_config.waiting_for_token = false;

                                    // TODO:: we should fail the promises
                                    api_config.request_buffer = [];
                                });
                        } else {
                            // No handler was available for the authentication request
                            api_config.request_buffer = [];
                            deferred.reject('no handler');
                        }

                        return deferred.promise;
                    },
                    refreshRequest = function (config, code) {
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
        
                                    // Place the access code in the system
                                    applyToken(config, success.access_token, success.expires_in);
        
                                    // setRefreshTokenMark
                                    $storage.setItem('refreshToken-' + config.scope, success.refresh_token);
                                    return success.access_token;
                                }, function (error) {
                                    // Refresh token is no more
                                    if (error.status !== 500) {
                                        $storage.removeItem('refreshToken-' + config.scope);
                                        return requestToken(config);
                                    }
                                });
                            };

                        if (code === undefined) {
                            return $storage.getItem('refreshToken-' + config.scope).then(function (token) {
                                options.grant_type = 'refresh_token';
                                options.refresh_token = token;
                                return performPost();
                            });
                        }
                        
                        options.grant_type = 'authorization_code';
                        options.code = code;
                        return performPost();
                    };


                // Inform $comms that a service is being performed
                $rootScope.$on('$comms.servicing', function (event, service) {
                    overrides[service] = true;
                });



                //
                // Internal signaling:
                //  We use emit to limit processing
                //

                // Retry required - most likely a timeout
                $rootScope.$on('$comms.serviceRetry', function (event, config, deferred) {
                    overrides.retry = false;
                    $rootScope.$broadcast('$comms.retry', config, deferred);

                    if (!overrides.retry) {
                        doRetry(config, deferred);
                    }
                });

                // Auth required
                $rootScope.$on('$comms.noAuth', function (event, api_config) {
                    // Start the oAuth2 request for the API in question if required
                    if (api_config.proactive || api_config.request_buffer.length > 0) {
                        api.tryAuth(api_config.id, true);
                    }
                });


                // return true when logged in
                api.authenticated = function (serviceId) {
                    !!api_configs[serviceId].access_token;
                };

                // returns a promise that resolves true if user was
                // able to grab an access token
                // rejects if login process is required
                api.tryAuth = function (serviceId, force) {
                    force = !!force;

                    if (checkingAuth[serviceId] === undefined) {
                        var deferred = $q.defer(),
                            config = api_configs[serviceId];

                        checkingAuth[serviceId] = deferred;

                        if (!!config.access_token) {
                            deferred.resolve(config.access_token);
                        } else {
                            $storage.getItem('refreshToken-' + config.scope).then(function (token) {
                               if (token) {
                                    deferred.resolve(refreshRequest(config));
                                } else {
                                    deferred.resolve(requestToken(config, !force));
                                }
                            }, function () {
                                deferred.resolve(requestToken(config, !force));
                            });
                        }

                        deferred.promise['finally'](function () {
                            delete checkingAuth[serviceId];
                        });

                        return deferred.promise;
                    } else if (force) {
                        return checkingAuth[serviceId].promise.catch(function () {
                            return api.tryAuth(serviceId, force);
                        });
                    }

                    return checkingAuth[serviceId].promise;
                };

                // Returns a promise that will force auth and return a valid auth token
                api.getToken = function (serviceId) {
                    return api.tryAuth(serviceId, true).then(function (success) {
                        return api_configs[serviceId].access_token;
                    });
                };

                // Similar to tryAuth force except 
                api.rememberMe = function (serviceId) {
                    var deferred = $q.defer(),
                        config = api_configs[serviceId],
                        codeFlow = function () {
                            checkingAuth[serviceId] = deferred;
                            deferred.resolve(requestToken(config, false, 'code').then(function (code) {
                                // Use the grant code to request a refresh token
                                return refreshRequest(config, code.code);
                            }));
                            deferred.promise['finally'](function () {
                                delete checkingAuth[serviceId];
                            });
                        };

                    if (checkingAuth[serviceId] === undefined) {
                        codeFlow();
                    } else {
                        checkingAuth[serviceId].promise.then(function () {
                            if (api.isRemembered(serviceId)) {
                                deferred.resolve(config.access_token);
                            } else {
                                codeFlow();
                            }
                        });
                    }

                    return deferred.promise;
                };

                api.isRemembered = function (serviceId) {
                    var config = api_configs[serviceId];
                    return $storage.getItem('refreshToken-' + config.scope).then(function (result) {
                        if (!result) {
                            return $q.reject(false);
                        }
                        
                        return result;
                    });
                };

                // Return the API
                return api;
            }];
        }])


        // Inject the interceptor
        .run(['$comms', function () {}]);

}(this.angular));
