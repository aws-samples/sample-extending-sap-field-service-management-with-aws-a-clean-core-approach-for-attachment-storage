// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "aws-cdk-lib";
import { Construct, IConstruct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export class CloudfrontServedEmptySpaBucket extends Construct {
  bucket: cdk.aws_s3.Bucket;
  distribution: cdk.aws_cloudfront.Distribution;
  constructor(
    scope: Construct,
    id: string,
    props?: {
      bucketName?: string;
      domainNames?: string[];
      certificate?: cdk.aws_certificatemanager.ICertificate;
      webAclId?: string;
      csp: {
        frameAncestors?: string;
        connectSrc?: string;
      };
    }
  ) {
    super(scope, id);

    const uniqueId = cdk.Names.uniqueResourceName(this, {});

    this.bucket = new cdk.aws_s3.Bucket(scope, `${uniqueId}Bucket`, {
      bucketName: props?.bucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
    });
    NagSuppressions.addResourceSuppressions(
      [this.bucket],
      [
        {
          id: "AwsSolutions-S1",
          reason:
            "The S3 Bucket has server access logs disabled––we use CloudFront access logs instead",
        },
      ]
    );
    const accessLogsBucket = new cdk.aws_s3.Bucket(
      scope,
      `${uniqueId}AccessLogsBucket`,
      {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
        encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        objectOwnership: cdk.aws_s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      }
    );
    NagSuppressions.addResourceSuppressions(
      [accessLogsBucket],
      [
        {
          id: "AwsSolutions-S1",
          reason: "This S3 Bucket is itself an access logs bucket",
        },
      ]
    );
    this.distribution = new cdk.aws_cloudfront.Distribution(
      scope,
      `${uniqueId}Distribution`,
      {
        defaultBehavior: {
          origin:
            cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
              this.bucket
            ),
          viewerProtocolPolicy:
            cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: new cdk.aws_cloudfront.ResponseHeadersPolicy(
            scope,
            `Headers${uniqueId}`,
            {
              responseHeadersPolicyName: `${cdk.Aws.STACK_NAME}${id}${cdk.Aws.REGION}ResponseHeadersPolicy`,
              securityHeadersBehavior: {
                contentSecurityPolicy: {
                  contentSecurityPolicy: `default-src 'self'; font-src 'self' data:; connect-src ${
                    props?.csp.connectSrc || "'none'"
                  }; img-src *; frame-ancestors ${
                    props?.csp.frameAncestors || "'none'"
                  }`,
                  override: true,
                },
                contentTypeOptions: {
                  override: true,
                },
                referrerPolicy: {
                  referrerPolicy:
                    cdk.aws_cloudfront.HeadersReferrerPolicy.SAME_ORIGIN,
                  override: true,
                },
                strictTransportSecurity: {
                  includeSubdomains: true,
                  override: true,
                  preload: true,
                  accessControlMaxAge: cdk.Duration.days(365),
                },
                xssProtection: {
                  override: true,
                  protection: true,
                  modeBlock: true,
                },
              },
            }
          ),
        },
        defaultRootObject: "index.html",
        errorResponses: [{ httpStatus: 403, responsePagePath: "/index.html" }],
        domainNames: props?.domainNames,
        certificate: props?.certificate,
        webAclId: props?.webAclId,
        logBucket: accessLogsBucket,
      }
    );
    cdk.Aspects.of(this.distribution).add(
      new OriginOriginAccessControlNameFix(
        `${cdk.Aws.STACK_NAME}${id}${cdk.Aws.REGION}OAC`
      )
    );
    NagSuppressions.addResourceSuppressions(
      [this.distribution],
      [
        {
          id: "AwsSolutions-CFR1",
          reason:
            "The CloudFront distribution may require Geo restrictions.––No concern for prototype",
        },
        {
          id: "AwsSolutions-CFR2",
          reason:
            "The CloudFront distribution may require integration with AWS WAF.––No concern for prototype",
        },
        {
          id: "AwsSolutions-CFR4",
          reason:
            "The CloudFront distribution allows for SSLv3 or TLSv1 for HTTPS viewer connections.––No concern for prototype",
        },
      ]
    );
  }
}

class OriginOriginAccessControlNameFix implements cdk.IAspect {
  constructor(private name: string) {}
  public visit(node: IConstruct): void {
    if (node instanceof cdk.aws_cloudfront.CfnOriginAccessControl) {
      node.addPropertyOverride("OriginAccessControlConfig.Name", this.name);
    }
  }
}
