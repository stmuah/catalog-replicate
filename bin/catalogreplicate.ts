#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CatalogReplicateStack, DeployType, ICustomProps } from '../lib/catalogreplicatestack';

const app = new cdk.App();

const DEBUG = true;

var input:string = app.node.tryGetContext('input')

if (input != "passive"){
  input = "active"
}
else {
  input = "passive"
}

const cl: ICustomProps = {
  deploytype: input=="active"? DeployType.active: DeployType.passive,
  active: 'us-east-1',
  passive: 'us-west-2',
  active_location: 'active',
  passive_location: 'passive'
};

const deployProps: ICustomProps = {
  env: { 
    region: cl.deploytype==DeployType.active? cl.active: cl.passive },
  active: cl.active,
  passive: cl.passive,
  active_location: cl.active_location,
  passive_location: cl.passive_location,
  deploytype: cl.deploytype
};

if (cl.deploytype == DeployType.active) {
  new CatalogReplicateStack(app, 'CatalogReplicateActive', deployProps);
} else {
  new CatalogReplicateStack(app, 'CatalogReplicatePassive', deployProps);
}