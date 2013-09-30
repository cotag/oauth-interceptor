'use strict';

describe('Service(Core): Communication', function () {

	// load the module we are testing
	beforeEach(module('OAuth'));


	var $comms, $httpBackend, $http, $rootScope,
		auth_req, authed, failed, retry, order,
		config, off_auth;


	// Configure the service
	beforeEach(module(function($commsProvider) {
		$commsProvider.service({
			id: 'QuayPay',
			oauth_server: 'http://localhost:3000/oauth/authorize',
			redirect_uri: 'http://localhost:9000/oauth.html',
			client_id: 'bb110d3d040e6424d0dbacb766a4ef94ad0551d8dd41e2f7265b88603bbc213d',
			api_endpoint: 'http://localhost:3000/api/v1/'
		});

		$commsProvider.ignore('http://localhost:3000/api/v1/user_confirm_retry.json');
	}));

	// Initialize the services
	beforeEach(inject(function($injector) {
		$rootScope = $injector.get('$rootScope');
		$http = $injector.get('$http');
		$httpBackend = $injector.get('$httpBackend');
		$comms = $injector.get('$comms');

		off_auth = $rootScope.$on('$comms.authenticate', function() {
			$rootScope.$emit('$comms.servicing', 'authenticate');		// We are going to perform this
		});
	}));

	// Clean up backend
	afterEach(function() {
		$httpBackend.verifyNoOutstandingExpectation();
		$httpBackend.verifyNoOutstandingRequest();
		off_auth();
	});


	describe('authentication', function () {

		beforeEach(function() {
			$rootScope.$on('$comms.authenticate', function(event, id, uri, deferred) {
				auth_req += 1;
				order.push('authenticate');
				deferred.resolve({
					token: 'valid token',
					expires_in: 300
				});
			});

			$rootScope.$on('$comms.authenticated', function(event, id, uri, deferred) {
				order.push('authenticated');
				config = id;	// config is passed in on these requests
				authed += 1;
			});

			auth_req = 0, authed = 0, order = [];
		});

		it('should fetch authentication token on first api request and then perform the request', function() {
			var result;
			$httpBackend.expectGET('http://localhost:3000/api/v1/me.json').respond(200, {userId: 'userX'});

			$http({method: 'GET', url: 'http://localhost:3000/api/v1/me.json'}).
			success(function(response) {
				result = 'success';
			}).error(function(rejection) {
				result = 'error';
			});

			$rootScope.$apply();	// Should call the authenticate request here (apply resolves pending promises)
			$httpBackend.flush();
			expect(result).toBe('success');

			
			expect(auth_req).toBe(1);
			expect(authed).toBe(1);

			expect(order).toEqual(['authenticate','authenticated']);
		});


		it('should silently retry requests after an authentication rejection', function() {
			var result;

			$httpBackend.expectGET('http://localhost:3000/api/v1/me.json').respond(401, '');
			$http({method: 'GET', url: 'http://localhost:3000/api/v1/me.json'}).
			success(function(response) {
				result = 'success';
			}).error(function(rejection) {
				result = 'error';
			});
			$rootScope.$apply();	// Should call the authenticate request here (apply resolves pending promises)
			expect(result).toBe(undefined);

			$httpBackend.expectGET('http://localhost:3000/api/v1/me.json').respond(200, {userId: 'userX'});
			$rootScope.$apply();	// Should retry the request here (apply resolves pending promises)
			$httpBackend.flush();
			expect(result).toBe('success');

			
			expect(auth_req).toBe(2);
			expect(authed).toBe(2);
			expect(order).toEqual(['authenticate','authenticated','authenticate','authenticated']);
		});


		it('should not intercept requests that are not to an API', function() {
			var result;

			$httpBackend.expectGET('http://localhost:3000/not/the/api.json').respond(200, {userId: 'userX'});

			$http({method: 'GET', url: 'http://localhost:3000/not/the/api.json'}).
			success(function(response) {
				result = 'success';
			}).error(function(rejection) {
				result = 'error';
			});

			$rootScope.$apply();	// Should call the authenticate request here (apply resolves pending promises)
			$httpBackend.flush();
			expect(result).toBe('success');

			
			expect(auth_req).toBe(0);
			expect(authed).toBe(0);
			expect(order).toEqual([]);
		});


		it('should not retry api requests that should be ignored', function() {
			var result;

			$httpBackend.expectGET('http://localhost:3000/api/v1/user_confirm_retry.json').respond(401, '');
			$http({method: 'GET', url: 'http://localhost:3000/api/v1/user_confirm_retry.json'}).
			success(function(response) {
				result = 'success';
			}).error(function(rejection) {
				result = 'error';
			});
			$rootScope.$apply();	// Should call the authenticate request here (apply resolves pending promises)
			$httpBackend.flush();
			expect(result).toBe('error');

			
			expect(auth_req).toBe(1);
			expect(authed).toBe(1);
			expect(order).toEqual(['authenticate','authenticated']);
		});



		//
		// TODO:: test retry delegation and exponential back off
		//

	});
});
