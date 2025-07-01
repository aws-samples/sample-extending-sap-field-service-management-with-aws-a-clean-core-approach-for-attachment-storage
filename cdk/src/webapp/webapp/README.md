# Web App

This Web App was bootstrapped with the React + TypeScript template from [Vite](https://vite.dev/)

Note that this web app is deployed as part of the AWS CDK deployment.

## Development workflow

Steps to run the web app locally:

1. Copy file `.env` to `.env.local` and then edit `.env.local` and enter all fields. View the right values to enter here, in the Back End's CDK stack outputs.
1. Make sure to install all dependencies: `npm install`
1. Run `npm run dev`
1. The web application runs at [http://localhost:5173/](http://localhost:5173/)

Steps to deploy the web app to S3:

1. Execute: `./deploy-spa.cjs`
