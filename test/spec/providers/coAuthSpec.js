'use strict';

describe('Directive(OAuth): coAuth', function () {

    // load the module we are testing
    beforeEach(module('OAuth'));

    var $comms, $rootScope, $compile, popup,
        $window, $q, $document, element, scope,
        origin = window.location.protocol + '//' + window.location.hostname,
        sendMessage = function(iframe, data, frompopup) {
            var event = $document[0].createEvent('HTMLEvents');
            event.initEvent('message', false, false);
            event.data = data;
            event.source = frompopup === true ? iframe : iframe[0].contentWindow;
            event.origin = origin;
            $window.dispatchEvent(event);
        };

    if (window.location.port !== '') {
        origin += ':' + window.location.port;
    }

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

        element = $compile('<div co-auth provider="QuayPay" login-type="Popup"></div>')($rootScope);

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
        expect(iframe.length).toBe(1);

        // START OF TEST::
        sendMessage(iframe, 'cancel');
        expect(element.find('iframe').length).toBe(0);
        expect(result).toBe('failure');
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
        expect(iframe.length).toBe(1);

        // START OF TEST::
        sendMessage(iframe, '{}');
        expect(element.find('iframe').length).toBe(0);
        expect(result).toBe('success');
    });

    it('should display the iframe if login is required', function() {
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
        expect(iframe.attr('style')).toBe(undefined);

        // START OF TEST::
        sendMessage(iframe, 'login');
        expect(element.find('iframe').length).toBe(1);
        expect(iframe.attr('style').length).toBeGreaterThan(1);

        // re-hide the iframe after login is successful
        sendMessage(iframe, 'retry');
        expect(element.find('iframe').length).toBe(1);
        expect(iframe.attr('style')).toBe(undefined);

        // complete when retry is successful
        sendMessage(iframe, '{}');
        expect(element.find('iframe').length).toBe(0);
        expect(result).toBe('success');
    });

    it('should be able to cancel the iframe at login stage', function() {
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
        expect(iframe.attr('style')).toBe(undefined);

        // START OF TEST::
        sendMessage(iframe, 'login');
        expect(element.find('iframe').length).toBe(1);
        expect(iframe.attr('style').length).toBeGreaterThan(1);

        // have the user cancel the iframe
        sendMessage(iframe, 'cancel');
        expect(element.find('iframe').length).toBe(0);
        expect(result).toBe('failure');
    });
});
