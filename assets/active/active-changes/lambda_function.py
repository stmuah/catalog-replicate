'''
This sample, non-production-ready template describes using Amazon Lambda, Amazon Glue API, Amazon SQS
and Amazon EventBridge to synchronize AWS Glue data catalog between one or more AWS Regions.  
© 2021 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.  
This AWS Content is provided subject to the terms of the AWS Customer Agreement available at  
http://aws.amazon.com/agreement or other written agreement between Customer and either
Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.
'''

import os
import boto3  
import json
from datetime import date
from botocore.config import Config
from boto3 import Session

botoSession = Session(region_name=os.environ['AWS_REGION'])
isActive = (os.environ['ACTIVE'] == 'True')
source_code = os.environ['SOURCEID']
eventbus=os.environ['EVENTBUS']
detail_type = os.environ['DETAIL_TYPE']

today = date.today()
yy = int(today.strftime("%Y"))
dd = int(today.strftime('%d'))
mm = int(today.strftime('%m'))

eb = botoSession.client('events')
sqs = botoSession.client('sqs')
glue = botoSession.client('glue')

def lambda_handler(event, context):
    catalog_change = event
    
    print('Entry:',catalog_change) #Sushant added print to check the structure of the event
    if not isActive:
        print('Running in Replica Mode. Exiting..')
        return
    
    try:
        
        # define the mappings for various catalog changes
        changeTypes = {'CreateDatabase':'CREATE_DATABASE',
                        'DeleteDatabase':'DELETE_DATABASE',
                        'CreateTable':'CREATE_TABLE',
                        'DeleteTable':'DELETE_TABLE',
                        'BatchDeleteTable':'DELETE_TABLE',
                        'UpdateTable':'UPDATE_TABLE',
                        'CreatePartition':'CREATE_TABLE_PARTITION',
                        'BatchCreatePartition':'CREATE_TABLE_PARTITION',
                        'DeletePartition':'DELETE_TABLE_PARTITION',
                        'BatchDeletePartition':'DELETE_TABLE_PARTITION'}
        
        # parse the payload for key values required for synchronization
        typeOfChange=catalog_change['detail']['typeOfChange']
        aws_region=catalog_change['region']
        aws_account=catalog_change['account']
        aws_resource=catalog_change['resources']
        dbName=catalog_change['detail']['databaseName']
        
        # get the change action from the mapping
        changeAction = changeTypes[typeOfChange] 
        
        # Handle special cases
        if changeAction in ['CREATE_TABLE','DELETE_TABLE']:
            changedTables=catalog_change['detail']['changedTables']   
        elif changeAction in ['UPDATE_TABLE','CREATE_TABLE_PARTITION','DELETE_TABLE_PARTITION']:
            changedTables=[catalog_change['detail']['tableName']]

        # Generally all DB Changes related to the catalog are table related
        # Table contains attributes as well as partitions
        # Load change tables meta data into payload along with source catalog info
        if changeAction == 'DELETE_DATABASE':
            metaData = [{
                'SourceMeta':{ 
                    'region':aws_region,
                    'accountID':aws_account, 
                    'changeAction':changeAction,
                    'database':dbName
                },
                'Database':dbName}]
        elif changeAction == 'DELETE_TABLE':
            metaData = [{
                'SourceMeta':{
                    'region':aws_region, 
                    'accountID':aws_account, 
                    'changeAction':changeAction,
                    'database':dbName
                },
                'Table': {'DatabaseName':dbName,'Tables':changedTables}}]
        elif changeAction =='CREATE_DATABASE':
            metaData = [{ 
                'SourceMeta':{
                    'region':aws_region,
                    'accountID':aws_account, 
                    'changeAction':changeAction,
                    'database':dbName
                },
                'Database':glue.get_database(Name=dbName)['Database']}]
            for tm in metaData:
                tm['Database'].pop('CreateTime') 
        elif changeAction in ['CREATE_TABLE_PARTITION','UPDATE_TABLE','CREATE_TABLE','DELETE_TABLE_PARTITION']:
            metaData = [{
                'SourceMeta':{
                    'region':aws_region,
                    'accountID':aws_account, 
                    'changeAction':changeAction,
                    'database':dbName,
                    'table':tblName
                },
                'Table':glue.get_table(DatabaseName=dbName,Name=tblName)['Table'],
                'Partitions':glue.get_partitions(DatabaseName=dbName,TableName=tblName)['Partitions']
            } for tblName in changedTables]
            
            #remove timestamp from JSON payload as they're not valid JSON types
            for tm in metaData:
                if 'CreateTime' in tm['Table']:
                     tm['Table'].pop('CreateTime')
                if 'UpdateTime' in tm['Table']:
                    tm['Table'].pop('UpdateTime')
                if 'LastAccessTime' in tm['Table']:
                    tm['Table'].pop('LastAccessTime') 
                if 'DatabaseName' in tm['Table']:
                    tm['Table'].pop('DatabaseName')
                if 'CatalogId' in tm['Table']:
                    tm['Table'].pop('CatalogId')
                if 'CreatedBy' in tm['Table']:
                    tm['Table'].pop('CreatedBy')
                if 'IsRegisteredWithLakeFormation' in tm['Table']:
                    tm['Table'].pop('IsRegisteredWithLakeFormation')
                
                for partition in tm['Partitions']:
                    if 'LastAccessTime' in partition:
                        partition.pop('LastAccessTime')
                    if 'CreationTime' in partition:
                        partition.pop('CreationTime')
                    if 'CatalogId' in partition:
                        partition.pop('CatalogId')
                    if 'DatabaseName' in partition:
                        partition.pop('DatabaseName')
                    if 'TableName' in partition:
                        partition.pop('TableName')                 
        else:
            print('THIS IS THE ACTION: {0}'.format(changeAction))
            
        # Get the DR Queue URL. 
        # If not available put changes in the backup queue

        entries = []
        for msg in metaData:
            entries.append({'Source': source_code,
                    'DetailType': detail_type,
                    'Detail': json.dumps(msg),
                    'EventBusName': eventbus
                })
            print('Each Message:\n',msg)
        response=eb.put_events(Entries=entries)
    except Exception as e:
        print('Error', e)
