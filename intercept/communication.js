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

    angular.module('OAuth', [])

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
            $httpProvider.interceptors.push(['$q', '$rootScope', function ($q, $rootScope) {
                return {
                    // Ensure the access token is attached to API requests
                    request: function (config) {
                        var i, api_config, deferred;

                        for (i = 0; i < api_endpoints.length; i += 1) {
                            if (config.url.match(api_endpoints[i][0])) {
                                api_config = api_configs[api_endpoints[i][1]];

                                if (api_config.access_token) {
                                    config.headers.Authorization = 'Bearer ' + api_config.access_token;
                                } else {
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
            this.$get = ['$window', '$q', '$timeout', '$http', '$rootScope', function ($window, $q, $timeout, $http, $rootScope) {

                var overrides = {},
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
                    requestToken = function (api_config) {
                        // One request at a time
                        if (api_config.waiting_for_token) { return; }

                        // Construct the request
                        var deferred = $q.defer(),
                            request = api_config.oauth_server + '?response_type=token'
                                        + '&redirect_uri=' + encodeURIComponent(api_config.redirect_uri)
                                        + '&client_id=' + encodeURIComponent(api_config.client_id);

                        if (api_config.scope) {
                            request += '&scope=' + encodeURIComponent(api_config.scope);
                        }

                        // Remove the token timeout if it exists
                        if (api_config.access_timeout !== undefined) {
                            $timeout.cancel(api_config.access_timeout);
                        }

                        // Request authentication for the API (delegating to a directive)
                        overrides.authenticate = false;
                        $rootScope.$broadcast('$comms.authenticate', api_config.id, request, deferred);

                        if (overrides.authenticate) {
                            // Handle the response
                            api_config.waiting_for_token = true;
                            deferred.promise.then(function (success) {
                                api_config.access_token = success.token;
                                api_config.waiting_for_token = false;

                                // Set a new timeout
                                api_config.access_timeout = $timeout(function () {
                                    api_config.access_timeout = undefined;
                                    api_config.access_token = undefined;
                                    $rootScope.$emit('$comms.noAuth', api_config);
                                }, success.expires_in * 1000);

                                // Inform listeners that we are authenticated
                                $rootScope.$broadcast('$comms.authenticated', api_config.id);
                                retryAll(api_config.request_buffer);

                            }, function () {     // On Failure
                                // Failure means that the auth directive is letting the user know of the error
                                // We should clear pending requests
                                api_config.waiting_for_token = false;
                                api_config.request_buffer = [];
                            });
                        } else {
                            // No handler was available for the authentication request
                            api_config.request_buffer = [];
                        }
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
                        requestToken(api_config);
                    }
                });

                return {};
            }];
        }])


        // Inject the interceptor
        .run(['$comms', function () {}]);

}(this.angular));
