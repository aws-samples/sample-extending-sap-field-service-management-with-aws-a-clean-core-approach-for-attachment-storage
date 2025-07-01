#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

set -euo pipefail

npx cdk synth --quiet

deploy() {
    export AWS_REGION="$1"

    echo "============================="
    echo "Deploying to $AWS_REGION"
    echo "============================="

    aws s3 cp "cdk.out/SapFsmAttachmentBackupStack.template.json" "s3://sap-fsm-extension-sample-${AWS_REGION}/"
    npx cdk-assets publish -p "cdk.out/SapFsmAttachmentBackupStack.assets.json"

    STACK_NAME="MySapFsmAttachmentBackupStack"
    TEMPLATE_URL="https://sap-fsm-extension-sample-${AWS_REGION}.s3.amazonaws.com/SapFsmAttachmentBackupStack.template.json"

    echo
    echo "Upload successful, visit the following link to deploy the stack:"
    echo "https://console.aws.amazon.com/cloudformation/home#/stacks/quickcreate?stackName=${STACK_NAME}&templateURL=${TEMPLATE_URL}"

    echo
}

for REGION in "us-east-1" "eu-west-1" "eu-central-1" "ap-southeast-2"; do
    deploy "$REGION"
done
