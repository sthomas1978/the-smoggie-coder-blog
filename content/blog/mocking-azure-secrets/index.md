---
title: Simulating Azure Secrets Locally
date: "2022-05-07T23:46:37.121Z"
---

#### Background

At my previous employer we were gradually rolling out some our applications to Azure and used Helm to deploy containers to AKS. For local testing purposes we used Docker compose to spin up instances and any peripheral services to test new features and bugs fixes.

As time went on it became more apparent that we should be testing as close as possible to a realistic deployment in prod. The development machines could run a local instance of kubernetes and we could deploy to the local kubernetes service using Helm

There were a couple of benefits to this

- Developers would gain knowledge of the production infrastructure
- Developers would have more understanding of kubernetes and how Helm works
- We would be implicitly testing the deployment process.

#### So what's was stopping us? 

The issue was is that we were using Azure secrets as an external dependency and was too much of a faff getting set up for each developer and tester.

#### What if we could mock some of the Azure Secrets Locally?

As part of the helm chart deployment, we were using the Kubernetes Secrets Store CSI Driver and the Azure Provider to connect to a secret store and map the secrets as volume into a Pod. The CSI Driver would connect to a provider using linux sockets and gPRC. As it happens you can build you own provider and register it with the CSI driver. Thus I decided to implement a custom provider using the ASP.NET Core Kestrel Web Server. Configure Kestrel to accept unix socket connections and build the gRPC service.

You can view the source code here https://dev.azure.com/sthomas1978/The%20Smoggie%20Coder/_git/Azure%20Secrets%20Provider%20Stub
You can get the provider container from here https://hub.docker.com/repository/docker/thesmoggiecoder/tsc-azure-secrets-stub

#### Caveats

CSI Driver sends the unix socket path in the host header, which kestrel will not like. To get around this we need to override the host header. There is an additional container sidecar which will overwrite the unix path in the host header to localhost, which gets around this problem for the time being, 

see https://github.com/dotnet/aspnetcore/issues/18522 for the issue and https://github.com/Zetanova/grpc-proxy for the sidecar container

#### Summary

This is a nice little handy feature to get developers up and running and testing using a  local kubernetes deployment without connecting to Azure for secrets.