import * as path from 'path';
import { EdgeFunction, LogLevel, EdgeRole } from '@cloudcomponents/cdk-lambda-at-edge-pattern';
import { aws_cloudfront, aws_cognito, aws_lambda } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface RedirectPaths {
  readonly signIn: string;
  readonly authRefresh: string;
  readonly signOut: string;
}

export interface AuthFlowProps {
  readonly logLevel: LogLevel;
  readonly userPool: aws_cognito.IUserPool;
  readonly userPoolClient: aws_cognito.IUserPoolClient;
  readonly cognitoAuthDomain: string;
  readonly redirectPaths: RedirectPaths;
  readonly oauthScopes: aws_cognito.OAuthScope[];
  readonly cookieSettings: Record<string, string>;
  readonly nonceSigningSecret: string;
  readonly clientSecret?: string;
  readonly httpHeaders?: Record<string, string>;
}

export class AuthFlow extends Construct {
  public readonly checkAuth: EdgeFunction;
  public readonly parseAuth: EdgeFunction;
  public readonly refreshAuth: EdgeFunction;
  public readonly signOut: EdgeFunction;

  constructor(scope: Construct, id: string, props: AuthFlowProps) {
    super(scope, id);

    const edgeRole = new EdgeRole(this, 'EdgeRole');

    const configuration = {
      logLevel: props.logLevel,
      redirectPathSignIn: props.redirectPaths.signIn,
      redirectPathAuthRefresh: props.redirectPaths.authRefresh,
      redirectPathSignOut: props.redirectPaths.signOut,
      userPoolId: props.userPool.userPoolId,
      clientId: props.userPoolClient.userPoolClientId,
      oauthScopes: props.oauthScopes.map((scope) => scope.scopeName),
      cognitoAuthDomain: props.cognitoAuthDomain,
      cookieSettings: props.cookieSettings,
      nonceSigningSecret: props.nonceSigningSecret,
      clientSecret: props.clientSecret,
      httpHeaders: props.httpHeaders ?? [],
    };

    this.checkAuth = new EdgeFunction(this, 'CheckAuth', {
      name: 'check-auth',
      code: aws_lambda.Code.fromAsset(path.join(__dirname, 'lambdas', 'check-auth')),
      edgeRole,
      configuration,
      eventType: aws_cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
    });

    this.parseAuth = new EdgeFunction(this, 'ParseAuth', {
      name: 'parse-auth',
      code: aws_lambda.Code.fromAsset(path.join(__dirname, 'lambdas', 'parse-auth')),
      edgeRole,
      configuration,
      eventType: aws_cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
    });

    this.refreshAuth = new EdgeFunction(this, 'RefreshAuth', {
      name: 'refresh-auth',
      code: aws_lambda.Code.fromAsset(path.join(__dirname, 'lambdas', 'refresh-auth')),
      edgeRole,
      configuration,
      eventType: aws_cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
    });

    this.signOut = new EdgeFunction(this, 'SignOut', {
      name: 'sign-out',
      code: aws_lambda.Code.fromAsset(path.join(__dirname, 'lambdas', 'sign-out')),
      edgeRole,
      configuration,
      eventType: aws_cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
    });
  }
}
