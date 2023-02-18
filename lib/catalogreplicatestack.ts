import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as _lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export enum DeployType {
  active = 1,
  passive = 2
};

export interface ICustomProps extends cdk.StackProps {
  active: string;
  passive: string;
  active_location: string;
  passive_location: string;
  deploytype: DeployType;
  accountId?: string;
};

export class CatalogReplicateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ICustomProps) {
    super(scope, id, props);
    this.processTemplate(this.parseTemplateInfo(props));
  }
  processTemplate(props: any) {
    var targetEventBus: targets.EventBus;

    const custom_bus = this.getCustomBus('CustomBus', props.bus_name);

    const pattern: events.EventPattern = this.getEventPattern(props);

    targetEventBus = new targets.EventBus(events.EventBus.fromEventBusArn(this, 'TargetEventBus',
      `arn:aws:events:${props.bus_region}:${props.accountId}:event-bus/default`));

    this.getEventBridgeRule('CustomBusRule', {
      ruleName: props.cb_rule_name, eventBus: custom_bus, enabled: true,
      eventPattern: pattern, targets: [targetEventBus]
    });

    const lambdas = this.getLambdas(props);

    const incoming_queue = this.getQueue(props);
    const eventSource = new SqsEventSource(incoming_queue, { batchSize: 1 });

    lambdas.lambda_in.addEventSource(eventSource);

    var patternTarget1 = this.getPatternTarget(props, lambdas, incoming_queue, 1);

    const db_rule_0 = this.getEventBridgeRule('UpdateCatalogPassive', {
      ruleName: patternTarget1.db_rule_name, enabled: true, eventPattern: patternTarget1.db_pattern, targets: [patternTarget1.db_target],
    });

    const patternTarget2 = this.getPatternTarget(props, lambdas, incoming_queue, 2);

    const db_rule_1 = this.getEventBridgeRule('UpdateCatalogActive', {
      ruleName: patternTarget2.db_rule_name, enabled: true, eventPattern: patternTarget2.db_pattern, targets: [patternTarget2.db_target],
    });
  }
  getPatternTarget(props: any, lambdas: any, incoming_queue: sqs.IQueue, grouping: number) {
    if (grouping == 1)
      return props.deploytype == DeployType.active ? {
        db_pattern: {
          detailType: ['Glue Data Catalog Database State Change', 'Glue Data Catalog Table State Change'],
          source: ['aws.glue'],
          region: [props.source_region]
        },
        db_target: new targets.LambdaFunction(lambdas.lambda_out),
        db_rule_name: props.rule_with_lambda_name
      }
        : {
          db_pattern: {
            detailType: [`Glue Catalog ${props.source_location}`.toLowerCase()],
            source: [`${props.source_location}.catalog.updates`],
            region: [props.source_region]
          },
          db_target: new targets.SqsQueue(incoming_queue),
          db_rule_name: props.rule_with_sqs_name
        }
    else
      return props.deploytype == DeployType.active ? {
        db_pattern: {
          detailType: [`Glue Catalog ${props.target_location}`.toLowerCase()],
          source: [`${props.target_location}.catalog.updates`],
          region: [props.target_region]
        },
        db_target: new targets.SqsQueue(incoming_queue),
        db_rule_name: props.rule_with_sqs_name
      }
        : {
          db_pattern: {
            detailType: ['Glue Data Catalog Database State Change', 'Glue Data Catalog Table State Change'],
            source: ['aws.glue'], region: [props.target_region]
          },
          db_target: new targets.LambdaFunction(lambdas.lambda_out),
          db_rule_name: props.rule_with_lambda_name
        }
  }
  getQueue(props: any) {
    return (new sqs.Queue(this, 'IncomingQueue', {
      visibilityTimeout: cdk.Duration.seconds(300), retentionPeriod: cdk.Duration.seconds(1209600), queueName: props.queue_name
    }));
  }
  getLambdas(props: any) {

    var region_lambda_role: iam.IRole;
    if (props.deploytype == DeployType.active)
      region_lambda_role = this.getLambdaRole(this.getPolicy(props.source_region, props.target_region), `active-${props.lambda_source_name}-role`);
    else
      region_lambda_role = this.getLambdaRole(this.getPolicy(props.source_region, props.target_region), `passive-${props.lambda_source_name}-role`);

    return props.deploytype == DeployType.active ?
      {
        lambda_in: this.getLambdaFunction('UpdateActiveLambda', props.lambda_target_name, {
          'RECORD_SOURCE': `${props.source_location}.catalog.updates`,
          'INCOMING_QUEUE': `demo-${props.target_location}-incoming`
        }, `./assets/active/${props.target_location}-changes`, region_lambda_role),
        lambda_out: this.getLambdaFunction('UpdatePassiveLambda', props.lambda_source_name, {
          'ACTIVE': 'True',
          'SOURCEID': `${props.source_location}.catalog.updates`,
          'EVENTBUS': `${props.bus_name}`,
          'DETAIL_TYPE': `Glue Catalog ${props.source_location}`.toLowerCase()
        }, `./assets/active/${props.source_location}-changes`, region_lambda_role),
      } :
      {
        lambda_in: this.getLambdaFunction('PublishToTarget', props.lambda_source_name, {
          'RECORD_SOURCE': `${props.target_location}.catalog.updates`,
          'INCOMING_QUEUE': `demo-${props.source_location}-incoming`
        }, `./assets/passive/${props.source_location}-changes`, region_lambda_role),
        lambda_out: this.getLambdaFunction('PublishToSource', props.lambda_target_name, {
          'ACTIVE': 'False',
          'SOURCEID': `${props.target_location}.catalog.updates`,
          'DETAIL_TYPE': `Glue Catalog ${props.target_location}`.toLowerCase(),
          'EVENTBUS': `${props.target_location}-lake-bus`
        }, `./assets/passive/${props.target_location}-changes`,region_lambda_role)
      };
  }
  parseTemplateInfo(props: ICustomProps) {
    return props.deploytype == DeployType.active ? {
      target_location: props.passive_location,
      source_location: props.active_location,
      deploytype: props.deploytype,
      accountId: this.account,
      bus_name: `${props.active_location}-lake-bus`,
      cb_rule_name: `publish-to-${props.passive_location}`,
      queue_name: `demo-${props.passive_location}-incoming`,
      lambda_source_name: `dr-demo-publish-${props.active_location}-changes`,
      lambda_target_name: `dr-demo-publish-${props.passive_location}-changes`,
      rule_with_lambda_name: `${props.active_location}-catalog-changes`,
      rule_with_sqs_name: `${props.passive_location}-catalog-changes`,
      target_region: props.passive,
      source_region: props.active,
      bus_region: props.passive
    } : {
      target_location: props.passive_location,
      source_location: props.active_location,
      deploytype: props.deploytype,
      accountId: this.account,
      bus_name: `${props.passive_location}-lake-bus`,
      cb_rule_name: `publish-to-${props.active_location}`,
      queue_name: `demo-${props.active_location}-incoming`,
      lambda_source_name: `dr-demo-publish-${props.active_location}-changes`,
      lambda_target_name: `dr-demo-publish-${props.passive_location}-changes`,
      rule_with_lambda_name: `${props.passive_location}-catalog-changes`,
      rule_with_sqs_name: `${props.active_location}-catalog-changes`,
      target_region: props.passive,
      source_region: props.active,
      bus_region: props.active
    }
  }
  getPolicy(region_a: string, region_p: string) {
    return (new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          resources: [`arn:aws:events:${region_p}:${this.account}:event-bus/*-lake-bus`,
          `arn:aws:events:${region_a}:${this.account}:event-bus/*-lake-bus`],
          actions: ['events:PutEvents'],
        }),
      ],
    }));
  }
  getRole(eventBusDoc: any) {
    //Bus Role
    const bus_role = new iam.Role(this, 'bus_role', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
      description: 'Policy to use for event bus',
      roleName: 'dr-event-bus-role',
      inlinePolicies: { buslakepolicy: eventBusDoc },
    });
  }
  getLambdaRole(eventBusDoc: any, roleName: string) {
    return (new iam.Role(this, 'lambdarole',
      {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        roleName: `${roleName}`,
        inlinePolicies: { dr_event_bridge_put: eventBusDoc },
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaSQSQueueExecutionRole')
        ]
      }));
  }
  getEventBridgeRule(Id: string, props: events.RuleProps) {
    return (new events.Rule(this, Id, props));
  }
  getLambdaFunction(Id: string, function_name: string, env_dyn: any, assets: string, functionRole: iam.IRole) {
    return (new _lambda.Function(this, Id, {
      runtime: _lambda.Runtime.PYTHON_3_9,
      code: _lambda.Code.fromAsset(assets),
      handler: 'lambda_function.lambda_handler',
      timeout: cdk.Duration.minutes(5),
      functionName: function_name,
      environment: env_dyn,
      role: functionRole
    }));
  }
  getCustomBus(Id: string, bus_name: string): events.IEventBus {
    return (new events.EventBus(this, Id, { eventBusName: bus_name }));
  }
  getEventPattern(props: any) {
    return props.deploytype == DeployType.passive ? {
      detailType: [`Glue Catalog ${props.target_location}`.toLowerCase()],
      source: [`${props.target_location}.catalog.updates`],
      region: [props.target_region]
    } : {
      detailType: [`Glue Catalog ${props.source_location}`.toLowerCase()],
      source: [`${props.source_location}.catalog.updates`],
      region: [props.source_region]
    };
  }
}
