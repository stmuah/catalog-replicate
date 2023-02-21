# Real-time Data Lake Replication using Native AWS Services and AWS Glue API


## Overview

Customers today continue to develop and build their cloud data platform using [AWS Modern Data Architecture](https://aws.amazon.com/big-data/datalakes-and-analytics/modern-data-architecture/).  This adoption is due to the availability of the broadest selection of purpose built analytics services.From data movement, data storage, data lakes, big data analytics, log analytics, streaming analytics, business intelligence, and machine learning (ML) to anything in between, AWS offers purpose-built services that provide the best price-performance, scalability , and lowest cost.  

At the core of the modern data architecture is the Scalable Data Lake, which allows customers to store their data in a highly durable object store [Amazon S3](), discover and extract meta data about their data using [AWS Glue Crawler](), catalog extracted meta data using [AWS Glue Data Catalog](), transform their data assets in a uniform manner using [AWS Glue ETL](), provide governance using [AWS Lake Formation]() and access to this data using [AWS Athena]().  

The AWS Glue catalog has become a critical component in this modern data architecture. As a result, customers have begun to inquire about ways to make their catalogs and lakes always available.  These services are [regional]() and are built to be resilient regionally.  While Amazon S3 has the capability  to provide [cross region replication](), the AWS Glue data catalog does not natively provide any such feature.  The only capability today is the [AWS Glue Catalog Replication Utility](https://github.com/aws-samples/aws-glue-data-catalog-replication-utility), which allows customers to configure and build some replication functionality.

The catalog replication utility allows the replication of the catalog from one AWS account to one or more AWS accounts.  The utility has dependencies on [Java]() and [JQ](https://stedolan.github.io/jq/).  Additionally, it requires building, deploying and running the replication tasks from a commandline.  There are also stated limitations:  
* Not intended for real-time replication  
* Not intended for two-way replication
* Does not resolve database and table name conflicts  

## Solution 
This architecture removes some of the limitations of the catalog replication utility and makes it easier to deploy and integrate.  It leverages highly resilient core services, and uses Python instead of Java.  The initial implementation allows for the configuration of an "active-passive" data lake replication setup and can easily be setup to replicate in a multi-region configuration.

The replication is near real-time using the AWS EventBridge's eventbus for cross region and cross account messaging and communications.  When activated, the replication occurs for every change to the catalog.  These changes may be triggered from the AWS Console, command line or API calls from other services such as AWS Glue Crawler.

### Prerequisites  
There are no external prerequisites to implement this architecture.  All services are native AWS foundational services:
* Compute: AWS Lambda
* Event Management and Messaging: AWS EventBridge (Bus, Rules)
* Queue Management: AWS Simple Queue Service (SQS)
* Catalog: AWS Glue Data Catalog (Data Lake Requirement)
* Storage: Amazon S3 (Data Lake Requirement)
* SDK: AWS SDK (Boto3)

#### [Architecture Diagram](https://go.gliffy.com/go/publish/13636362)
![](ctiarch.png)

### Artifacts and Objects
The solution uses the [AWS CDK](https://aws.amazon.com/cdk/) using Typescript to generate the [AWS CloudFormation](https://aws.amazon.com/cloudformation/) templates for the active and passive deployments.
* [Active Template](./cdk.out/CatalogReplicateActive.template.json)
* [Passive Template](./cdk.out/CatalogReplicatePassive.template.json)  

## How to Use this Artifact  
1. Download and install [Node](https://nodejs.org/en/download/)
2. Install [AWS CDK](https://aws.amazon.com/getting-started/guides/setup-cdk/module-two/)
3. Access to the repo on [Github](https://github.com/stmuah/catalog-replicate)

## Project Folder Structure
```markdown
Project Rooe
|--assets [folder containing Lambda functions]
|  |--active
|  |  |--active-changes
|  |      lambda_function.py
|
|  |  |--passive-changes
|        lambda_function.py
|
|  |--passive
|     |--active-changes
|         lambda_function.py
|     |--passive-changes
|        lambda_function.py
|--bin [folder containing the CDK stack launcher]
|  catalogreplicate.ts
|
|--cdk.out [folder containing the generated templates and artifacts]
|
|--lib [folder containing the catalogreplicate stack and classes]
|  catalogreplicatestack.ts


```

## Authors and acknowledgment


## License
For open source projects, say how it is licensed.

## Project status
If you have run out of energy or time for your project, put a note at the top of the README saying that development has slowed down or stopped completely. Someone may choose to fork your project or volunteer to step in as a maintainer or owner, allowing your project to keep going. You can also make an explicit request for maintainers.
