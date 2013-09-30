# OAuth Communications Interceptor

[![Build Status](https://travis-ci.org/cotag/oauth-interceptor.png?branch=master)](https://travis-ci.org/cotag/oauth-interceptor)


Behind the scenes, attaches tokens to requests that require authentication and if not authenticated triggers the authentication process before retrying / completing the request

## Installation

1. Open bower.json
2. Add `"oauth-interceptor": "~1.0.0"` to your dependency list
3. Run `bower install`
4. In your application you can now add:
   * `<script src="bower_components/intercept/communication.js"></script>`


## Usage

Requires a compatible directive for obtaining the OAuth Tokens

