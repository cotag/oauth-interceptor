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


    module
    .provider('$comms', ['$httpProvider', function ($httpProvider) {
        var endpoints = [],     // List of configured service endpoints
            lookup = {},
            ignore_list = {},
            provider = this;   // List of URI's we don't want to retry


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
            var enpoint = new OAuthEndPoint(options);

            if (options.isolate) {
                endpoints.push(enpoint);
            } else {
                endpoints.unshift(enpoint);
            }

            if (options.id) {
                lookup[options.id] = enpoint;
            }

            return enpoint;
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
                    var endpoint,
                        request_buffer,
                        config,
                        i;

                    for (i = 0; i < endpoints.length; i += 1) {
                        endpoint = endpoints[i];
                        request_buffer = endpoint.request_buffer();
                        config = endpoint.config();

                        if (request.url.match(endpoint.uri())) {
                            if (endpoint.authenticated()) {
                                request.sent_at = Date.now();
                                request.headers.Authorization = 'Bearer ' + endpoint.access_token();

                            } else if (!config.when_prompted || request_buffer.length > 0) {
                                var deferred = $q.defer();

                                // We save the request and instead request a token
                                request_buffer.push({
                                    request: request,
                                    deferred: deferred
                                });

                                if (!endpoint.authenticating()) {
                                    endpoint.authenticate();
                                }

                                return deferred.promise;
                            }
                        }
                    }

                    return request;
                },

                responseError: function (response) {

                    // Check if failures to the URL are to be ignored
                    if (
                        response.status == 401 && 
                        ignore_list[response.config.url] === undefined
                    ) {
                        var request_retry,
                            endpoint,
                            request_buffer,
                            deferred,
                            config,
                            match,
                            i;


                        for (i = 0; i < endpoints.length; i += 1) {
                            endpoint = endpoints[i];
                            request_retry = endpoint.request_retry();

                            if (response.config.url.match(endpoint.uri())) {
                                deferred = $q.defer();

                                if (endpoint.authenticated_at() > response.config.sent_at) {
                                    // retry request if auth occured after the request was made
                                    endpoint.retryRequest(response.config, deferred);

                                } else {
                                    request_retry.push({
                                        response: response,
                                        deferred: deferred
                                    });

                                    if (!endpoint.authenticating()) {
                                        endpoint.authenticate();
                                    }
                                }

                                return deferred.promise;    // no need to break;
                            }
                        }
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
                getEndpoint = function (id) {
                    if (id) {
                        return lookup[id];
                    } else {
                        return endpoints[0];
                    }
                };


            // Provide the endpoint all the required deps
            angular.forEach(endpoints, function (endpoint) {
                endpoint.onLoad($window, $q, $timeout, $http, scope, $location);
            });


            // These are public API calls:
            api.isRemembered = function (id) {
                return getEndpoint(id).isRemembered();
            };

            api.rememberMe = function (id) {
                return getEndpoint(id).rememberMe();
            };

            // Non-destructive authentication attempt
            api.tryAuth = function (force, id) {
                return  getEndpoint(id).tryAuth(force);
            };

            api.getToken = function (id) {
                return api.tryAuth(true, id);
            };

            api.authenticated = function (id) {
                return getEndpoint(id).authenticated();
            };

            api.clearAuth = function (id) {
                return getEndpoint(id).clearAuth();
            };

            // Callback on token update
            api.notifier = function (callback, id) {
                getEndpoint(id).notifier(callback);
            };


            api.hasProvider = function (id) {
                return lookup[id];
            };

            api.addProvider = function (config) {
                provider.service(config).onLoad($window, $q, $timeout, $http, scope, $location);
            };


            return api;
        }];
    }])

    .run(['$comms', angular.noop]);
}(this.angular, this));

