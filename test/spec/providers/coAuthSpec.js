'use strict';

describe('Directive(OAuth): coAuth', function () {

    // load the module we are testing
    beforeEach(module('OAuth'));

    var $comms, $rootScope, $compile, popup,
        $window, $q, $document, element, scope,
        sendMessage = function(iframe, data, frompopup) {
            var event = $document[0].createEvent('HTMLEvents');
            event.initEvent('message', false, false);
            event.data = data;
            event.source = frompopup === true ? iframe : iframe[0].contentWindow;
            event.origin = 'null';
            $window.dispatchEvent(event);
        };

    // Configure the service
    beforeEach(module(function($commsProvider) {
        $commsProvider.service({
            id: 'QuayPay',
            oauth_server: 'http://localhost:3000/oauth/authorize',
            redirect_uri: 'http://localhost:9000/oauth.html',
            client_id: 'bb110d3d040e6424d0dbacb766a4ef94ad0551d8dd41e2f7265b88603bbc213d',
            api_endpoint: 'http://localhost:3000/api/v1/'
        });
    }));

    // Initialize the services and build the directive
    beforeEach(inject(function($injector) {
        $rootScope = $injector.get('$rootScope');
        $comms = $injector.get('$comms');
        $compile = $injector.get('$compile');
        $window = $injector.get('$window');
        $q = $injector.get('$q');
        $document = $injector.get('$document');

        element = $compile('<div co-auth provider-id="QuayPay"></div>')($rootScope);

        scope = element.scope();
        $window.open = function() {
            popup = {
                closed: false,
                close: function() {
                    popup.closed = true;
                }
            };
            return popup;
        };

        $rootScope.$on('$comms.servicing', function(event, service) {
            expect(service).toBe('authenticate');
        });
    }));


    afterEach(function() {
        scope.$destroy();
    });


    it('should not display anything until a request for auth is recieved', function() {
        var login = element.children('div');
        expect(login.is(':visible')).toBe(false);
    });


    it('should display a login overlay when we are not authenticated', function() {
        var deferred = $q.defer(),
            iframe,
            result;

        deferred.promise.then(function(success) {
            result = 'success';
        }, function(failure) {
            result = 'failure';
        });
        $rootScope.$broadcast('$comms.authenticate', 'QuayPay', 'chrome://version/', deferred);
        
        iframe = element.find('iframe');
        expect(iframe.length).toBe(1);
        expect(scope.login_required).toBe(false);

        sendMessage(iframe, 'login');    // This triggeres the display of the login overlay

        expect(element.find('iframe').length).toBe(0);
        expect(scope.login_required).toBe(true);
        expect(result).toBe(undefined);

        element.find('button').trigger('click');
        expect(popup.closed).toBe(false);
    });


    it('should remove the login overlay once authenticated', function() {
        var deferred = $q.defer(),
            iframe,
            result;

        deferred.promise.then(function(success) {
            result = 'success';
        }, function(failure) {
            result = 'failure';
        });
        $rootScope.$broadcast('$comms.authenticate', 'QuayPay', 'chrome://version/', deferred);
        
        iframe = element.find('iframe');
        sendMessage(iframe, 'login');    // This triggeres the display of the login overlay
        element.find('button').trigger('click');

        // START OF TEST::
        sendMessage(popup, '{}', true);
        expect(result).toBe('success');
        expect(popup.closed).toBe(true);

        $rootScope.$broadcast('$comms.authenticated', 'QuayPay');
        expect(scope.login_required).toBe(false);
    });

    it('should not remove the login overlay and close the popup on failure', function() {
        var deferred = $q.defer(),
            iframe,
            result;

        deferred.promise.then(function(success) {
            result = 'success';
        }, function(failure) {
            result = 'failure';
        });
        $rootScope.$broadcast('$comms.authenticate', 'QuayPay', 'chrome://version/', deferred);
        
        iframe = element.find('iframe');
        sendMessage(iframe, 'login');    // This triggeres the display of the login overlay
        element.find('button').trigger('click');

        // START OF TEST::
        sendMessage(popup, 'error', true);
        expect(result).toBe(undefined);
        expect(popup.closed).toBe(true);
        expect(scope.login_required).toBe(true);
    });

    it('should remove the login overlay and close the popup on user cancel', function() {
        var deferred = $q.defer(),
            iframe,
            result;

        deferred.promise.then(function(success) {
            result = 'success';
        }, function(failure) {
            result = 'failure';
        });
        $rootScope.$broadcast('$comms.authenticate', 'QuayPay', 'chrome://version/', deferred);
        
        iframe = element.find('iframe');
        sendMessage(iframe, 'login');    // This triggeres the display of the login overlay
        element.find('button').trigger('click');

        // START OF TEST::
        element.find('span').trigger('click');
        expect(result).toBe('failure');
        expect(popup.closed).toBe(true);
        expect(scope.login_required).toBe(false);
    });

    it('should display the iframe when confirmation is required', function() {
        var deferred = $q.defer(),
            iframe,
            result;

        deferred.promise.then(function(success) {
            result = 'success';
        }, function(failure) {
            result = 'failure';
        });
        $rootScope.$broadcast('$comms.authenticate', 'QuayPay', 'chrome://version/', deferred);
        
        iframe = element.find('iframe');

        // START OF TEST::
        sendMessage(iframe, 'confirm');    // This triggeres the display of the login overlay
        expect(element.find('iframe').length).toBe(1);
        sendMessage(iframe, '{}');
        expect(result).toBe('success');
        expect(element.find('iframe').length).toBe(0);
    });

    it('should display login overlay on iframe error', function() {
        var deferred = $q.defer(),
            iframe,
            result;

        deferred.promise.then(function(success) {
            result = 'success';
        }, function(failure) {
            result = 'failure';
        });
        $rootScope.$broadcast('$comms.authenticate', 'QuayPay', 'chrome://version/', deferred);
        
        iframe = element.find('iframe');

        // START OF TEST::
        sendMessage(iframe, 'error');    // This triggeres the display of the login overlay
        expect(element.find('iframe').length).toBe(0);
        expect(result).toBe(undefined);
        expect(scope.login_required).toBe(true);
    });

    it('should cancel request on iframe confirm cancel', function() {
        var deferred = $q.defer(),
            iframe,
            result;

        deferred.promise.then(function(success) {
            result = 'success';
        }, function(failure) {
            result = 'failure';
        });
        $rootScope.$broadcast('$comms.authenticate', 'QuayPay', 'chrome://version/', deferred);
        
        iframe = element.find('iframe');

        // START OF TEST::
        sendMessage(iframe, 'cancel');    // This triggeres the display of the login overlay
        expect(element.find('iframe').length).toBe(0);
        expect(result).toBe('failure');
        expect(scope.login_required).toBe(false);
    });

    it('should authenticate silently when already logged in', function() {
        var deferred = $q.defer(),
            iframe,
            result;

        deferred.promise.then(function(success) {
            result = 'success';
        }, function(failure) {
            result = 'failure';
        });
        $rootScope.$broadcast('$comms.authenticate', 'QuayPay', 'chrome://version/', deferred);
        
        iframe = element.find('iframe');

        // START OF TEST::
        sendMessage(iframe, '{}');    // This triggeres the display of the login overlay
        expect(element.find('iframe').length).toBe(0);
        expect(result).toBe('success');
    });
});
