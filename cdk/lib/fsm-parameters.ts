// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Define an interface for the FSM parameters
export interface FsmParameters {
  clientId: string;
  clientVersion: string;
  accountId: string;
  companyId: string;
  createNewCloudTrail: boolean;
  sapFsmBaseUrl: string;
  jwksPath: string;
  oauthTokenPath: string;
  attachmentApiPath: string;
  businessRuleApiPath: string;
}
