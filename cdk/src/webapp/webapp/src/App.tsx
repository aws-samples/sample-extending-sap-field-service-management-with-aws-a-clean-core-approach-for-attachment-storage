// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useFsmShellContext } from "./fsm-shell-context";
import useSWR from "swr";

function App() {
  const { context, isLoading: isLoadingContext } = useFsmShellContext();
  const accessToken =
    context?.auth?.access_token ??
    sessionStorage.getItem("SAP_FSM_ACCESS_TOKEN"); // for development
  const {
    data: metrics,
    error,
    isLoading: isLoadingDiagramUrls,
  } = useSWR(accessToken ? "api/metrics" : null, (path) =>
    fetch(path, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }).then(
      (res) =>
        ensureJsonResponse(
          res,
          "Failed to get Amazon CloudWatch metrics"
        ).json() as Promise<{
          s3BucketName: string;
          s3ObjectCountDiagramUrl: string;
          s3BucketSizeBytesDiagramUrl: string;
          lambdaFnErrorsDiagramUrl: string;
          lambdaFnInvocationsDiagramUrl: string;
          functionLogsUrl: string;
          webHookInvocationsDiagramUrl: string;
        }>
    )
  );

  return (
    <>
      {error && (
        <div style={{ color: "red", fontWeight: "bolder" }}>
          {error.message}
        </div>
      )}
      {!!metrics?.s3BucketName && (
        <>
          <div style={{ fontSize: "1.5rem", marginTop: "2rem" }}>
            Backup bucket:&nbsp;
            <a
              href={`https://console.aws.amazon.com/s3/buckets/${metrics.s3BucketName}?bucketType=general&tab=objects`}
              target="_blank"
            >
              {metrics.s3BucketName}
            </a>
          </div>
        </>
      )}
      {!accessToken && isLoadingContext && (
        <div>Loading SAP FSM context ...</div>
      )}
      {!accessToken && !isLoadingContext && (
        <div style={{ color: "red", fontWeight: "bolder" }}>
          Failed to acquire SAP FSM context (likely this web page is not
          currently running inside SAP FSM?)
        </div>
      )}
      {!!accessToken && isLoadingDiagramUrls && (
        <div>Loading Amazon CloudWatch information ...</div>
      )}
      {metrics && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginTop: "1.5rem",
            placeContent: "center",
            maxWidth: "85vw",
          }}
        >
          <BoxedDiagram
            url={metrics.s3ObjectCountDiagramUrl}
            alt="S3 Object Count"
            explanation={
              <>
                The total number of objects in the S3 bucket (updated daily).
                <br />
                <br />
                This is the number of attachments in SAP FSM that have been
                successfully backed up to Amazon S3.
              </>
            }
            title="Nr of objects in S3"
          />
          <BoxedDiagram
            url={metrics.s3BucketSizeBytesDiagramUrl}
            alt="S3 Bucket Size"
            explanation="The total combined size of all objects in the S3 bucket in bytes (updated daily)."
            title="S3 Bucket Size"
          />
          <BoxedDiagram
            url={metrics.webHookInvocationsDiagramUrl}
            alt="API Gateway Webhook Invocation Count"
            explanation="The number of times the web hook was invoked by a SAP FSM Business Rule (bucketed per 5 min)."
            title="API Gateway Webhook Invocations"
          />
          <BoxedDiagram
            url={metrics.lambdaFnErrorsDiagramUrl}
            alt="Lambda Function Error Count"
            explanation={
              <>
                The number of times the AWS Lambda function, that is responsible
                for backing up attachments to Amazon S3, failed (bucketed per 5
                min).
                <br />
                <br />
                View the function logs&nbsp;
                <a href={metrics.functionLogsUrl} target="_blank">
                  here
                </a>
                .
              </>
            }
            title="Lambda Function Errors"
          />
          <BoxedDiagram
            url={metrics.lambdaFnInvocationsDiagramUrl}
            alt="Lambda Function Invocation Count"
            explanation="The number of times the AWS Lambda function, that is responsible for backing up attachments to Amazon S3, was invoked (bucketed per 5 min)."
            title="Lambda Function Invocations"
          />
        </div>
      )}
    </>
  );
}

function BoxedDiagram(props: {
  url: string;
  alt: string;
  explanation: React.ReactNode;
  title: string;
}) {
  return (
    <div
      style={{
        border: "1px solid black",
        padding: "1rem",
        maxWidth: "600px",
      }}
    >
      <h3>{props.title}</h3>
      <img height={400} width={600} src={props.url} alt={props.alt} />
      <p>{props.explanation}</p>
    </div>
  );
}

export default App;

function ensureJsonResponse(res: Response, msg: string) {
  if (
    !res.ok ||
    !res.headers.get("content-type")?.startsWith("application/json")
  ) {
    throw new Error(msg);
  }
  return res;
}
