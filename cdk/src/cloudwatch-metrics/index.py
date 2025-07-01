# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import os.path
from pathlib import Path
from os import scandir
import json
import logging

import boto3
from botocore.client import Config

logger = logging.getLogger()
logger.setLevel("INFO")

AWS_REGION = os.environ["AWS_REGION"]
BUCKET_NAME = os.environ["BUCKET_NAME"]
LAMBDA_FUNCTION_NAME = os.environ["LAMBDA_FUNCTION_NAME"]
FUNCTION_LOGS_URL = (
    f"https://{AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region={AWS_REGION}"
    "#logsV2:logs-insights$3FqueryDetail$3D~(end~0~start~-86400~timeType~'RELATIVE~tz~'LOCAL~unit~'seconds~editorString~"
    "'fields*20*40timestamp*2c*20*40message*2c*20*40logStream*2c*20*40log*0a*7c*20sort*20*40timestamp*20desc*0a*7c*20limit*2010000"
    f"~queryId~'1859e2bf-77e3-43c6-8569-31df8047ba4f~source~(~'*2faws*2flambda*2f{LAMBDA_FUNCTION_NAME}))"
)


client = boto3.client("cloudwatch", config=Config(signature_version="v4"))

HERE = Path(__file__).parent

widgets = {}
for definition in scandir(HERE / "definitions"):
    if definition.is_file() and definition.name.endswith(".json"):
        with open(definition) as f:
            widgets[Path(definition).stem] = (
                f.read()
                .replace("<BUCKET_NAME>", os.environ["BUCKET_NAME"])
                .replace("<FUNCTION_NAME>", os.environ["LAMBDA_FUNCTION_NAME"])
            )


def create_presigned_url_for_widget(metric_widget):
    url = client.generate_presigned_url(
        "get_metric_widget_image",
        Params={"MetricWidget": metric_widget, "OutputFormat": "image/png"},
        ExpiresIn=60,
        HttpMethod="GET",
    )
    return url


def handler(event, context):
    logger.info("Event: %s", event)
    body = {
        f"{name}DiagramUrl": create_presigned_url_for_widget(definition)
        for name, definition in widgets.items()
    }
    body["s3BucketName"] = BUCKET_NAME
    body["functionLogsUrl"] = FUNCTION_LOGS_URL
    return {
        "statusCode": 200,
        "body": json.dumps(body),
    }
