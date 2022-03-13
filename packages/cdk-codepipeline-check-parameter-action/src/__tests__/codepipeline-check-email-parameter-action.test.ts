import { Stack } from 'aws-cdk-lib';
import { Repository } from 'aws-cdk-lib/aws-codecommit';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeCommitSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import 'jest-cdk-snapshot';

import { CodePipelineCheckEmailParameterAction } from '../codepipeline-check-email-parameter-action';

test('default setup', (): void => {
  const stack = new Stack();

  const repository = new Repository(stack, 'Repository', {
    repositoryName: 'MyRepositoryName',
    description: 'Some description.',
  });

  const parameterName = '/test';

  const sourceArtifact = new Artifact();

  new Pipeline(stack, 'Pipeline', {
    stages: [
      {
        stageName: 'Source',
        actions: [
          new CodeCommitSourceAction({
            actionName: 'CodeCommit',
            repository,
            output: sourceArtifact,
          }),
        ],
      },
      {
        stageName: 'CheckParamter',
        actions: [
          new CodePipelineCheckEmailParameterAction({
            actionName: 'CheckParamter',
            parameterName,
          }),
        ],
      },
    ],
  });

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
  });
});
