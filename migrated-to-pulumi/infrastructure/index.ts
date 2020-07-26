import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { join } from 'path'

function preName(name?: string) {
  const namePrefix = `${pulumi.getStack()}-${pulumi.getProject()}`
  return name ? `${namePrefix}-${name}` : namePrefix
}

function relativeRootPath(path: string) {
  return join(process.cwd(), '..', path)
}

/**
 * Globals
 */
const account = pulumi.output(aws.getCallerIdentity({ async: true })).accountId
const executionRoleName = preName('executionRole')
const todosDynamoDbTableName = preName()
const createTodoFunctionName = preName('createTodo')

/**
 * DynamoDb Table
 */
const todosDynamoDbTable = new aws.dynamodb.Table(todosDynamoDbTableName, {
  name: todosDynamoDbTableName,
  attributes: [
    {
      name: 'id',
      type: 'S'
    }
  ],
  hashKey: 'id',
  billingMode: 'PROVISIONED',
  readCapacity: 1,
  writeCapacity: 1,
  tags: {
    Environment: pulumi.getStack()
  }
})

/**
 * IAM Role
 */
const executionRole = new aws.iam.Role(executionRoleName, {
  name: executionRoleName,
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'lambda.amazonaws.com' }),
  tags: {
    Environment: pulumi.getStack()
  }
})
const executionRolePolicyName = `${executionRoleName}-policy`
const rolePolicy = new aws.iam.RolePolicy(executionRolePolicyName, {
  name: executionRolePolicyName,
  role: executionRole,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: account.apply(
          (accountId) =>
            `arn:aws:logs:${aws.config.region}:${accountId}:log-group:/aws/lambda/${createTodoFunctionName}*`
        )
      },
      {
        Effect: 'Allow',
        Action: [
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem'
        ],
        Resource: account.apply(
          (accountId) => `arn:aws:dynamodb:${aws.config.region}:${accountId}:table/${todosDynamoDbTableName}`
        )
      }
    ]
  }
})

/**
 * Code Archive & Lambda layer
 */
const code = new pulumi.asset.AssetArchive({
  '.': new pulumi.asset.FileArchive(relativeRootPath('build/archive.zip'))
})

const zipFile = relativeRootPath('layers/archive.zip')
const nodeModuleLambdaLayerName = preName('lambda-layer-nodemodules')
const nodeModuleLambdaLayer = new aws.lambda.LayerVersion(nodeModuleLambdaLayerName, {
  compatibleRuntimes: [aws.lambda.NodeJS12dXRuntime],
  code: new pulumi.asset.FileArchive(zipFile),
  layerName: nodeModuleLambdaLayerName
})

/**
 * Lambda Function
 */
const createTodoFunction = new aws.lambda.Function(createTodoFunctionName, {
  name: createTodoFunctionName,
  runtime: aws.lambda.NodeJS12dXRuntime,
  handler: 'functions/create.create',
  role: executionRole.arn,
  code,
  layers: [nodeModuleLambdaLayer.arn],
  memorySize: 128,
  environment: {
    variables: {
      DYNAMODB_TABLE: todosDynamoDbTableName
    }
  },
  tags: {
    Environment: pulumi.getStack()
  }
})

/**
 * API Gateway
 */
const createTodoApiRest = new aws.apigateway.RestApi(preName('rest'), {
  name: preName('rest')
})
const createTodoApiResource = new aws.apigateway.Resource(preName('resource'), {
  restApi: createTodoApiRest.id,
  parentId: createTodoApiRest.rootResourceId,
  pathPart: '{new}'
})
const createTodoApiMethod = new aws.apigateway.Method(preName('method'), {
  restApi: createTodoApiRest.id,
  resourceId: createTodoApiResource.id,
  authorization: 'NONE',
  httpMethod: 'POST'
})
const createTodoApiIntegration = new aws.apigateway.Integration(preName('integration-post'), {
  restApi: createTodoApiRest.id,
  resourceId: createTodoApiResource.id,
  httpMethod: createTodoApiMethod.httpMethod,
  integrationHttpMethod: 'POST',
  type: 'AWS_PROXY',
  uri: createTodoFunction.invokeArn
})

const createTodoApiDeployment = new aws.apigateway.Deployment(
  preName('deployment'),
  {
    stageName: pulumi.getStack(),
    restApi: createTodoApiRest.id
  },
  {
    dependsOn: [createTodoApiIntegration]
  }
)

const createTodoApiLambdaPermission = new aws.lambda.Permission(`${createTodoFunctionName}-permission`, {
  statementId: 'AllowAPIGatewayInvoke',
  principal: 'apigateway.amazonaws.com',
  action: 'lambda:InvokeFunction',
  function: createTodoFunction,
  sourceArn: pulumi.output(createTodoApiRest.executionArn).apply((executionArn) => `${executionArn}/*/*`)
})

export const createTodoApiUrl = createTodoApiDeployment.invokeUrl
