// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as events from "aws-cdk-lib/aws-events";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";

export class SapFsmAttachmentBackup extends Construct {
  eventBus: events.EventBus;
  eventSource = "sap.attachment.created" as const;
  api: apigateway.RestApi;
  webhookUrl: string;
  apiKeyArn: string;
  apiKeyId: string;
  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.eventBus = new events.EventBus(scope, "WebhookEventBus", {
      eventBusName: cdk.Fn.join("-", [cdk.Aws.STACK_NAME, "sap-fsm-events"]),
    });

    const sapIpAddresses = [
      "52.215.254.13",
      "34.248.99.195",
      "52.51.152.247",
      "18.197.181.254",
      "18.194.49.168",
      "18.197.98.115",
      "34.206.233.192",
      "35.171.250.242",
      "18.204.30.89",
      "54.223.84.241",
      "54.223.156.141",
      "54.222.140.43",
      "13.237.251.35",
      "13.239.110.236",
      "3.105.114.153",
    ];

    const sapIpRanges = new cdk.CfnParameter(scope, "SapFsmIpRanges", {
      type: "CommaDelimitedList",
      description: "Comma-separated list of allowed IP ranges for API Gateway",
      default: sapIpAddresses.join(","),
    });

    const additionalIpRanges = new cdk.CfnParameter(
      scope,
      "AdditionalIpRanges",
      {
        type: "CommaDelimitedList",
        description:
          "Comma-separated list of additional allowed IP ranges for API Gateway (e.g. use this for developer IP addresses)",
        default: "127.0.0.1",
      }
    );

    const allowPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.AnyPrincipal()],
      actions: ["execute-api:Invoke"],
      resources: [
        `arn:aws:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*/*`,
      ],
    });

    const denyPolicy = new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ["execute-api:Invoke"],
      resources: [
        `arn:aws:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*/*/POST/*`,
      ],
      conditions: {
        NotIpAddress: {
          "aws:SourceIp": cdk.Fn.split(
            ",",
            cdk.Fn.join(",", [
              cdk.Fn.join(",", sapIpRanges.valueAsList),
              cdk.Fn.join(",", additionalIpRanges.valueAsList),
            ])
          ),
        },
      },
    });

    const policy = new iam.PolicyDocument({
      statements: [allowPolicy, denyPolicy],
    });

    const accessLogs = new cdk.aws_logs.LogGroup(this, `ApigwAccessLogs${id}`, {
      retention: cdk.aws_logs.RetentionDays.INFINITE,
    });

    const api = new apigateway.RestApi(scope, "WebhookApi", {
      restApiName: "SAP Webhook Service",
      description: "Handles webhook events from FSM",
      policy: policy,
      deployOptions: {
        stageName: "api",
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        tracingEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogs),
        accessLogFormat: apigateway.AccessLogFormat.custom(
          JSON.stringify({
            status: "$context.status",
            requestId: "$context.requestId",
            extendedRequestId: "$context.extendedRequestId",
            resourcePath: "$context.resourcePath",
            httpMethod: "$context.httpMethod",
            sourceIp: "$context.identity.sourceIp",
            userAgent: "$context.identity.userAgent",
            apiKey: "$context.identity.apiKey",
            authorizerStatus: "$context.authorizer.status",
            sapFsmUserId: "$context.authorizer.userId",
            sapFsmUser: "$context.authorizer.user",
            sapFsmPermissionGroupId: "$context.authorizer.permissionGroupId",
            sapFsmAccountId: "$context.authorizer.accountId",
          })
        ),
      },
    });
    this.api = api;

    const requestValidator = new cdk.aws_apigateway.RequestValidator(
      scope,
      "ReqValidator",
      {
        restApi: api,
        requestValidatorName: "req-validator",
        validateRequestBody: true,
        validateRequestParameters: true,
      }
    );

    const attachmentCreatedModel = new apigateway.Model(
      scope,
      "AttachmentCreatedModel",
      {
        restApi: api,
        contentType: "application/json",
        modelName: "AttachmentCreatedModel",
        schema: {
          type: apigateway.JsonSchemaType.OBJECT,
          properties: {
            detailType: {
              type: apigateway.JsonSchemaType.STRING,
              enum: ["AttachmentCreated"],
            },
            detail: {
              type: apigateway.JsonSchemaType.OBJECT,
              properties: {
                fileName: { type: apigateway.JsonSchemaType.STRING },
                attachmentId: { type: apigateway.JsonSchemaType.STRING },
                description: { type: apigateway.JsonSchemaType.STRING },
                type: { type: apigateway.JsonSchemaType.STRING },
                lastChanged: { type: apigateway.JsonSchemaType.STRING },
                lastChangedByClientVersion: {
                  type: apigateway.JsonSchemaType.STRING,
                },
                id: { type: apigateway.JsonSchemaType.STRING },
                createPerson: { type: apigateway.JsonSchemaType.STRING },
                createDateTime: {
                  type: apigateway.JsonSchemaType.STRING,
                  format: "date-time",
                },
                lastChangedBy: { type: apigateway.JsonSchemaType.STRING },
              },
              required: [
                "fileName",
                "attachmentId",
                "description",
                "type",
                "lastChanged",
                "lastChangedByClientVersion",
                "id",
                "createPerson",
                "createDateTime",
                "lastChangedBy",
              ],
            },
          },
          required: ["detailType", "detail"],
        },
      }
    );

    const apiKey = api.addApiKey("WebhookApiKey");

    const apiKeyRateLimit = new cdk.CfnParameter(scope, "ApiKeyRateLimit", {
      type: "Number",
      description:
        "The maximum TPS (number of initiated backups per second) allowed on the API key",
      default: 10,
    });

    const apiKeyBurstLimit = new cdk.CfnParameter(scope, "ApiKeyBurstLimit", {
      type: "Number",
      description:
        "The burst TPS (number of initiated backups per second) allowed on the API key",
      default: 5,
    });

    const usagePlan = api.addUsagePlan("UsagePlan", {
      name: "WebhookUsagePlan",
      apiStages: [{ api, stage: api.deploymentStage }],
      throttle: {
        rateLimit: apiKeyRateLimit.valueAsNumber,
        burstLimit: apiKeyBurstLimit.valueAsNumber,
      },
    });

    usagePlan.addApiKey(apiKey);
    this.apiKeyId = apiKey.keyId;
    this.apiKeyArn = apiKey.keyArn;

    const res = "events";
    const eventResource = api.root.addResource(res);
    this.webhookUrl = api.url + res;

    const apiGatewayRole = new iam.Role(scope, "ApiGatewayRole", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
    });

    apiGatewayRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [this.eventBus.eventBusArn],
      })
    );

    const sendEventMethod = eventResource.addMethod(
      "POST",
      new apigateway.AwsIntegration({
        service: "events",
        action: "PutEvents",
        integrationHttpMethod: "POST",
        options: {
          credentialsRole: apiGatewayRole,
          passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
          requestTemplates: {
            "application/json": `
#set($context.requestOverride.header.X-Amz-Target = "AWSEvents.PutEvents")
#set($context.requestOverride.header.Content-Type = "application/x-amz-json-1.1")

{
  "Entries": [{
    "Source": "${this.eventSource}",
    "DetailType": $input.json('$.detailType'),
    "Detail": "$util.escapeJavaScript($input.json('$.detail'))",
    "EventBusName": "${this.eventBus.eventBusArn}"
  }]
}`,
          },
          integrationResponses: [
            {
              statusCode: "200",
              responseTemplates: {
                "application/json": `{"eventId": $input.json('$.Entries[0].EventId')}`,
              },
            },
          ],
        },
      }),
      {
        requestModels: {
          "application/json": attachmentCreatedModel,
        },
        requestValidator: requestValidator,
        requestParameters: {},
        apiKeyRequired: true,
      }
    );

    NagSuppressions.addResourceSuppressions(
      [sendEventMethod],
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "We use API key and IP whitelist as authorization mechanism, since that is what SAP webhooks support (static header)",
        },
        {
          id: "AwsSolutions-COG4",
          reason:
            "We use API key and IP whitelist as authorization mechanism, since that is what SAP webhooks support (static header)",
        },
      ]
    );

    sendEventMethod.addMethodResponse({
      statusCode: "200",
      responseModels: {
        "application/json": new apigateway.Model(scope, "ResponseModel", {
          restApi: api,
          contentType: "application/json",
          modelName: "ResponseModel",
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              message: { type: apigateway.JsonSchemaType.STRING },
            },
          },
        }),
      },
    });
  }
}
