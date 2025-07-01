// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { join } from "path";

export class WebApp extends Construct {
  constructor(
    scope: Construct,
    id: string,
    {
      bucket,
    }: {
      bucket: cdk.aws_s3.Bucket;
    }
  ) {
    super(scope, id);

    const crHandlerFn = new cdk.aws_lambda_nodejs.NodejsFunction(
      scope,
      `WebAppHandler${id}`,
      {
        entry: join(__dirname, "../src/webapp/index.ts"),
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(300),
        memorySize: 3008,
        bundling: {
          commandHooks: {
            afterBundling(inputDir, outputDir) {
              return [
                `rm -rf ${inputDir}/src/webapp/webapp/node_modules`,
                `cp -R ${inputDir}/src/webapp/webapp ${outputDir}`,
              ];
            },
            beforeBundling: () => [],
            beforeInstall: () => [],
          },
        },
        ephemeralStorageSize: cdk.Size.mebibytes(2048),
      }
    );
    bucket.grantReadWrite(crHandlerFn);
    NagSuppressions.addResourceSuppressions(
      crHandlerFn,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Needs to read and write to the S3 bucket",
        },
      ],
      true
    );
    new cdk.CfnResource(scope, `WebApp${id}`, {
      type: "Custom::WebApp",
      properties: {
        ServiceToken: crHandlerFn.functionArn,
        BucketName: bucket.bucketName,
      },
    });
  }
}
