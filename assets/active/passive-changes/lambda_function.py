'''
This sample, non-production-ready template describes using Amazon Lambda, Amazon Glue API, Amazon SQS
and Amazon EventBridge to synchronize AWS Glue data catalog between one or more AWS Regions.  
© 2021 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.  
This AWS Content is provided subject to the terms of the AWS Customer Agreement available at  
http://aws.amazon.com/agreement or other written agreement between Customer and either
Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.
'''

import os
import json
import boto3
from botocore.config import Config
from boto3 import Session


active_region = os.environ['AWS_REGION']
queue_name = os.environ['INCOMING_QUEUE']
record_check_source = os.environ['RECORD_SOURCE']

botoSession = Session(region_name=active_region)

sqs = botoSession.client('sqs')
glue = botoSession.client('glue')

def lambda_handler(event, context):

    accountID =aws_account_id = context.invoked_function_arn.split(":")[4]

    for record in event['Records']:
        record_check = json.loads(record['body'])
        if record_check['source'] == record_check_source:
            continue
        
        catalog_change = record_check['detail']
        
        print('This is the catalog incoming change:\n',catalog_change)
        
        changeAction = catalog_change['SourceMeta']['changeAction']    
        print(changeAction,":\n",event)

        if changeAction == 'DELETE_DATABASE':
            try:
                glue.delete_database(Name=catalog_change['Database'])
            except glue.exceptions.EntityNotFoundException:
                print('Database does not exist')
        elif changeAction =='DELETE_TABLE':
            dbName = catalog_change['Table']['DatabaseName']
            for tblName in catalog_change['Table']['Tables']:
                try:
                    glue.delete_table(DatabaseName=dbName,Name=tblName)
                except glue.exceptions.EntityNotFoundException:
                    print('Table {0} does not exist'.format(tblName))
        elif changeAction == 'CREATE_DATABASE':
            try:
                catalog_change['Database'].pop('CatalogId')
                glue.create_database(DatabaseInput=catalog_change['Database'])
            except glue.exceptions.AlreadyExistsException as e:
                print('Failed Record\n',event)
        elif  changeAction in ['UPDATE_TABLE','CREATE_TABLE','DELETE_TABLE_PARTITION','CREATE_TABLE_PARTITION']:
            try:
                dbName = catalog_change['SourceMeta']['database']
                tblInput = catalog_change['Table']
                tblInput['StorageDescriptor']['Location'] = tblInput['StorageDescriptor']['Location'].replace('west','east')

                if changeAction in ['UPDATE_TABLE','DELETE_TABLE_PARTITION','CREATE_TABLE_PARTITION']:
                    glue.delete_table(DatabaseName=dbName,Name=tblInput['Name'])
                    glue.create_table(DatabaseName=dbName,TableInput=tblInput)
                else:
                    try:
                        glue.create_table(DatabaseName=dbName,TableInput=tblInput)
                    except glue.exceptions.AlreadyExistsException:
                        print('Table already exists')
                    
                partitions = catalog_change['Partitions']
                for part in partitions:
                    part['StorageDescriptor']['Location'] = part['StorageDescriptor']['Location'].replace('west','east')
            
                partitionSize = len(partitions)
                for lwr in range(0,partitionSize,100):
                    batchPart = partitions[lwr:lwr+100]
                    glue.batch_create_partition(DatabaseName=dbName,
                    TableName=tblInput['Name'],PartitionInputList=batchPart)
            except glue.exceptions.EntityNotFoundException:
                # Get the DR Queue URL. The DR AccountID can be an environment variable 
                queue_url = sqs.get_queue_url(
                    QueueName=queue_name,
                    QueueOwnerAWSAccountId=accountID)['QueueUrl']     
                    
                # Send the Catalog Changes Payload to the DR Queue
                sqs.send_message(QueueUrl=queue_url,
                    MessageBody=json.dumps(catalog_change))
            except Exception as e:
                print(e)

