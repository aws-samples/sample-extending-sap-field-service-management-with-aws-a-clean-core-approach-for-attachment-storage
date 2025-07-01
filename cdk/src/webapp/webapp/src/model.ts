// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface FsmShellContext {
  cloudHost: string;
  account: string;
  accountId: string;
  company: string;
  companyId: string;
  selectedLocale: string;
  selectedThemeId: string;
  user: string;
  userId: string;
  userAccountFeatureFlagsEnabled: boolean;
  userAccountFeatureFlagsUserId: string;
  erpType: string;
  erpUserId: string;
  extension?: {
    deploymentId: string;
  };
  viewState: {
    selectedSidebar?: {
      eventId: string;
      id: string;
    };
    activityID?: string;
    selectedBusinessPartnerId?: string;
    selectedServiceCallId?: string;
  };
  outlet?: { name: string };
  isInsideShellModal: boolean;
  auth?: {
    access_token: string;
    token_type: string;
    expires_in: number;
  };
  authToken?: string;
}
