# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import json
import logging
from time import time
import urllib.request
import urllib.parse
import urllib.error
import base64
from typing import Literal, TypedDict, List

import boto3

FSM_BASE_URL = os.environ["FSM_BASE_URL"]
ATTACHMENT_API_PATH = os.environ["ATTACHMENT_API_PATH"]
OAUTH2_TOKEN_PATH = os.environ["OAUTH2_TOKEN_PATH"]
S3_BUCKET_NAME = os.environ["S3_BUCKET_NAME"]
S3_KEY_PREFIX = os.environ.get("PREFIX", "uploads/")
CLIENT_SECRET_ARN = os.environ["CLIENT_SECRET_ARN"]

logger = logging.getLogger()
logger.setLevel("INFO")

s3_client = boto3.client("s3")
secretsmanager_client = boto3.client("secretsmanager")


def handler(event: "AttachmentEvent", context):
    logger.info("Received event: %s", json.dumps(event))

    # Retrieve secret properties from Secrets Manager
    client_secret_string = secretsmanager_client.get_secret_value(
        SecretId=CLIENT_SECRET_ARN
    )["SecretString"]
    client_secret = json.loads(client_secret_string)

    fsm_client_id = client_secret["fsmClientId"]
    fsm_client_version = client_secret["fsmClientVersion"]
    fsm_account_id = client_secret["fsmAccountId"]
    fsm_company_id = client_secret["fsmCompanyId"]

    logger.info(
        f"FSM_CLIENT_ID: {fsm_client_id} FSM_CLIENT_VERSION: {fsm_client_version} FSM_ACCOUNT_ID: {fsm_account_id} FSM_COMPANY_ID: {fsm_company_id}"
    )

    # Fetch the OAuth Access Token for retrieving the attachment file data
    access_token = fetch_oauth_token(client_secret)

    fsm_headers = {
        "X-Account-ID": fsm_account_id,
        "X-Company-ID": fsm_company_id,
        "X-Client-ID": fsm_client_id,
        "X-Client-Version": fsm_client_version,
        "Authorization": f"Bearer {access_token}",
    }

    detail = event["detail"]
    file_url = f"{FSM_BASE_URL}{ATTACHMENT_API_PATH.format(attachment_id=detail["attachmentId"])}"
    request = urllib.request.Request(file_url, headers=fsm_headers)

    # Upload the attachment to S3
    key = f"{S3_KEY_PREFIX}{detail["id"]}/{detail["fileName"]}"
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with urllib.request.urlopen(request) as response:
            logger.info(f"Uploading file to s3://{S3_BUCKET_NAME}/{key} ...")
            s3_client.upload_fileobj(
                response,
                S3_BUCKET_NAME,
                key,
                ExtraArgs={"Metadata": detail},
            )
            logger.info("File uploaded successfully")
    except urllib.error.HTTPError as e:
        if e.status == 404:
            logger.warning(
                "Attachment not found in SAP FSM (is this a test invocation?): %s",
                detail["attachmentId"],
            )
            return
        if e.status in [401, 403]:
            global _tokens_expire_at
            _tokens_expire_at = time()
        raise


_token_response: "TokenResponse | None" = None
_tokens_expire_at = time()


def fetch_oauth_token(client_secret):
    global _token_response, _tokens_expire_at
    if _token_response and _tokens_expire_at > time():
        logger.info("Using cached OAuth token")
        return _token_response["access_token"]

    logger.info("Fetching OAuth token ...")

    credentials = f"{client_secret["clientId"]}:{client_secret["clientSecret"]}"
    encoded_credentials = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
    headers = {
        "Authorization": f"Basic {encoded_credentials}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode("utf-8")
    request = urllib.request.Request(
        FSM_BASE_URL + OAUTH2_TOKEN_PATH, data=data, headers=headers
    )

    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with urllib.request.urlopen(request) as response:
            response_data = response.read()
            token_response = json.loads(response_data.decode("utf-8"))
            # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
            logger.info(
                "OAuth token fetched successfully: %s",
                json.dumps(
                    {
                        k: v if k != "access_token" else "XXXXXXXXX"
                        for k, v in token_response.items()
                    },
                    separators=(",", ":"),
                ),
            )
            _token_response = token_response
            _tokens_expire_at = time() + token_response["expires_in"] - 10
            return token_response["access_token"]
    except urllib.error.HTTPError as e:
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.error("Error fetching OAuth token: %s", e.read().decode("utf-8"))
        raise e


class AttachmentDetail(TypedDict):
    fileName: str
    attachmentId: str
    description: str
    type: str
    lastChanged: str
    lastChangedByClientVersion: str
    id: str
    createPerson: str
    createDateTime: str
    lastChangedBy: str


class AttachmentEvent(TypedDict):
    detailType: Literal["AttachmentCreated"]
    detail: AttachmentDetail


class Company(TypedDict):
    id: int
    name: str
    strictEncryptionPolicy: bool
    permissionGroupId: int


class TokenResponse(TypedDict):
    access_token: str
    token_type: str
    expires_in: int
    companies: List[Company]
    account_id: int
    authorities: List[str]
    account: str
    permission_group_id: int
    scope: str
    cluster_url: str
