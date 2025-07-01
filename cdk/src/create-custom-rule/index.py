# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import json
import logging
import urllib.request
import urllib.parse
import urllib.error
import base64
from typing import Dict, NotRequired, TypedDict, List

import boto3
from botocore.exceptions import ClientError

FSM_BASE_URL = os.environ["FSM_BASE_URL"]
OAUTH2_TOKEN_PATH = os.environ["OAUTH2_TOKEN_PATH"]
CLIENT_SECRET_ARN = os.environ["CLIENT_SECRET_ARN"]
FSM_CUSTOM_RULE_PATH = os.environ["FSM_CUSTOM_RULE_PATH"]
FSM_CLIENT_ID = os.environ["FSM_CLIENT_ID"]
FSM_CLIENT_VERSION = os.environ["FSM_CLIENT_VERSION"]
FSM_ACCOUNT_ID = os.environ["FSM_ACCOUNT_ID"]
FSM_COMPANY_ID = os.environ["FSM_COMPANY_ID"]
STACK_NAME = os.environ["STACK_NAME"]
AWS_REGION = os.environ["AWS_REGION"]

RULE_CODE = f"Backup-attachments-to-aws-s3-{STACK_NAME}-{AWS_REGION}"
RULE_DESCRIPTION = (
    "This BR invokes your webhook on AWS, to back up new attachments to Amazon S3"
)

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

logger.info(
    f"FSM_CLIENT_ID: {FSM_CLIENT_ID} FSM_CLIENT_VERSION: {FSM_CLIENT_VERSION} FSM_ACCOUNT_ID: {FSM_ACCOUNT_ID} FSM_COMPANY_ID: {FSM_COMPANY_ID}"
)

secretsmanager_client = boto3.client("secretsmanager")
apigateway_client = boto3.client("apigateway")


def get_api_key_value(api_key_id):
    apigateway_client = boto3.client("apigateway")

    try:
        # Attempt to retrieve the actual API key value
        logger.info(f"Attempting to retrieve API key for ID: {api_key_id}")

        response = apigateway_client.get_api_key(apiKey=api_key_id, includeValue=True)

        api_key = response["value"]
        logger.info("Successfully retrieved the API key.")
        return api_key

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        logger.error(
            f"ClientError occurred: {error_code}, Message: {e.response['Error']['Message']}"
        )

        # Handle specific error codes if needed
        if error_code == "AccessDeniedException":
            logger.error(
                "Access Denied. Ensure that the correct IAM permissions are in place."
            )
        elif error_code == "NotFoundException":
            logger.error(f"API Key with ID {api_key_id} not found.")
        else:
            logger.error(f"An unexpected error occurred: {e}")

        # Optionally re-raise or handle the exception as needed
        raise

    except Exception as e:
        # Catch-all for any other errors
        logger.error(f"An unexpected error occurred: {e}")
        raise


def create_custom_rule(fsm_headers):
    # Ensure required environment variables and parameters are set
    api_key_id = os.getenv("API_KEY_ID", None)
    webhook_url = os.getenv("API_WEBHOOK_URL", None)

    if not api_key_id or not webhook_url:
        raise ValueError("Missing required parameters: API_KEY_ID, or API_WEBHOOK_URL")

    api_key = get_api_key_value(api_key_id)

    # Query parameters
    query_params = {"dtos": "CustomRule.9"}

    # Encode the query parameters
    encoded_query = urllib.parse.urlencode(query_params)

    # Create the full URL with the query string
    url_with_query = f"{FSM_BASE_URL}{FSM_CUSTOM_RULE_PATH}?{encoded_query}"

    data: CustomRuleData = {
        "code": RULE_CODE,
        "name": "s3-backup-rule",
        "eventType": "CREATE",
        "type": "TWO",
        "permissionsType": "USER",
        "embedded": False,
        "enabled": True,
        "objectType": "ATTACHMENT",
        "executionType": "ON_SUCCESS",
        "description": RULE_DESCRIPTION,
        "inactive": False,
        "responsible": "bersanf@amazon.ch",
        "actions": [
            {
                "executionCount": "1",
                "name": "HttpRequest",
                "parameters": {
                    "url": webhook_url,
                    "body": """{ 
                        "detailType": "AttachmentCreated", 
                        "detail": { 
                            "fileName": "${attachment.fileName}", 
                            "attachmentId": "${attachment.id}", 
                            "description": "${attachment.description}", 
                            "type": "${attachment.type}", 
                            "lastChanged": "${attachment.lastChanged}", 
                            "lastChangedByClientVersion": "${attachment.lastChangedByClientVersion}", 
                            "id": "${attachment.id}", 
                            "createPerson": "${attachment.createPerson}", 
                            "createDateTime": "${attachment.createDateTime}", 
                            "lastChangedBy": "${attachment.lastChangedBy}" 
                        } 
                    }""",
                    "method": "POST",
                    "headers": [{"name": "x-api-key", "value": api_key}],
                    "contentType": "application/json",
                    "responseVariable": "response",
                },
            }
        ],
    }

    logger.info(json.dumps(data))

    # Convert data to JSON
    json_data = json.dumps(data).encode("utf-8")

    # Create the request object
    request = urllib.request.Request(
        url_with_query, headers=fsm_headers, data=json_data, method="POST"
    )

    # Send the request and handle response
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with urllib.request.urlopen(request) as response:
            response_data = response.read().decode("utf-8")
            logger.info(f"Response Data: {response_data}")
    except urllib.error.HTTPError as e:
        logger.info(f"HTTP Error: {e.code} {e.reason}")
        logger.info(f"Response Headers: {e.headers}")  # Additional error info
        logger.info(f'Error Message: {e.read().decode("utf-8")}')
    except urllib.error.URLError as e:
        logger.info(f"URL Error: {e.reason}")


def find_business_rule(fsm_headers):
    # https://{cluster}.fsm.cloud.sap/api/data/v4/{resourceName}?dtos={resourceName.dtoVersion}
    # Create a request object
    base_url = url_with_query = f"{FSM_BASE_URL}{FSM_CUSTOM_RULE_PATH}"

    # Creating a dynamic query string with proper handling of quotes
    query = f'code="{RULE_CODE}"'

    # Query parameters
    query_params = {"query": query, "dtos": "CustomRule.9"}

    # Encode the query parameters
    encoded_query = urllib.parse.urlencode(query_params)

    # Create the full URL with the query string
    url_with_query = f"{base_url}?{encoded_query}"

    request = urllib.request.Request(url_with_query, headers=fsm_headers)

    # Send the request and capture the response
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with urllib.request.urlopen(request) as response:
            # Read and decode the response
            response_data = response.read().decode("utf-8")
            logger.info(f"Response Data: {response_data}")
    except urllib.error.HTTPError as e:
        logger.info(f"HTTP Error: {e.code} {e.reason}")
    except urllib.error.URLError as e:
        logger.info(f"URL Error: {e.reason}")


def handler(event, context):
    logger.info("Received event: %s", json.dumps(event))

    access_token = fetch_oauth_token()
    fsm_headers = {
        "X-Account-ID": FSM_ACCOUNT_ID,
        "X-Company-ID": FSM_COMPANY_ID,
        "X-Client-ID": FSM_CLIENT_ID,
        "X-Client-Version": FSM_CLIENT_VERSION,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    # find_business_rule(fsm_headers)
    create_custom_rule(fsm_headers)


def fetch_oauth_token():
    client_secret_string = secretsmanager_client.get_secret_value(
        SecretId=CLIENT_SECRET_ARN
    )["SecretString"]
    client_secret = json.loads(client_secret_string)
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
            token_response: TokenResponse = json.loads(response_data.decode("utf-8"))
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
            return token_response["access_token"]
    except urllib.error.HTTPError as e:
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.error("Error fetching OAuth token: %s", e.read().decode("utf-8"))
        raise e


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


class ActionParameters(TypedDict):
    url: str
    body: str
    method: str
    headers: List[Dict[str, str]]
    responseVariable: str
    contentType: str | None


class Action(TypedDict):
    executionCount: str
    name: str
    parameters: ActionParameters


class CustomRuleData(TypedDict):
    code: str
    name: str
    # id: NotRequired[int]
    eventType: str
    type: str
    executionType: str
    enabled: bool
    objectType: str
    responsible: NotRequired[str]
    permissionsType: str
    inactive: NotRequired[bool]
    embedded: bool
    description: NotRequired[str]
    actions: List[Action]
