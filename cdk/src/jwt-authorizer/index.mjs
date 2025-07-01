// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { JwtVerifier } from "aws-jwt-verify";
import {
  assertStringArraysOverlap,
  assertStringEquals,
} from "aws-jwt-verify/assert";

const { SAP_COMPANY_ID, SAP_ACCOUNT_ID, SAP_FSM_BASE_URI, JWKS_PATH } =
  process.env;
if (!SAP_COMPANY_ID || !SAP_ACCOUNT_ID || !SAP_FSM_BASE_URI || !JWKS_PATH) {
  throw new Error(
    "SAP_COMPANY_ID, SAP_ACCOUNT_ID, SAP_FSM_BASE_URI, JWKS_PATH must be set in the environment"
  );
}

const sapFsmJwtVerifier = JwtVerifier.create({
  issuer: null, // SAP FSM tokens do not have an iss claim
  audience: null, // SAP FSM tokens do not have an aud claim
  customJwtCheck: ({ payload }) => {
    assertStringArraysOverlap(
      "Company ID",
      payload.companies.map((c) => `${c.id}`),
      SAP_COMPANY_ID
    );
    assertStringEquals("Account ID", `${payload.account_id}`, SAP_ACCOUNT_ID);
  },
  jwksUri: `${SAP_FSM_BASE_URI}${JWKS_PATH}`,
  includeRawJwtInErrors: true,
});

// hydrate the cache as part of the Lambda Function cold start
await sapFsmJwtVerifier.hydrate();

export const handler = async (event) => {
  try {
    const accessToken = event.authorizationToken.replace(/^bearer +/i, "");

    const payload = await sapFsmJwtVerifier.verify(accessToken);

    const authResponse = {
      principalId: payload.user_name,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: event.methodArn,
          },
        ],
      },
      context: {
        userId: payload.user_name,
        user: payload.user,
        permissionGroupId: payload.permission_group_id,
        accountId: payload.account_id,
      },
    };
    console.log("Access granted:", JSON.stringify(authResponse));

    return authResponse;
  } catch (err) {
    console.log(err);
    // API Gateway wants this *exact* error message, otherwise it returns 500 instead of 401:
    throw new Error("Unauthorized");
  }
};
