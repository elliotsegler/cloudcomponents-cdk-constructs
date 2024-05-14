import { BuildSpec, ComputeType, LinuxBuildImage, Project } from 'aws-cdk-lib/aws-codebuild';
import { IRepository } from 'aws-cdk-lib/aws-codecommit';
import { OnEventOptions, Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { CodeBuildProject } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3CodeCommitBackupProps {
  /**
   * Bucket for storing the backups.
   */
  readonly backupBucket: Bucket;

  /**
   * Schedule for backups.
   */
  readonly schedule: Schedule;

  /**
   * Repository to be backed up
   */
  readonly repository: IRepository;

  /**
   * The type of compute to use for backup the repositories.
   * See the {@link ComputeType} enum for the possible values.
   *
   * @default taken from {@link #buildImage#defaultComputeType}
   */
  readonly computeType?: ComputeType;
}

export class S3CodeCommitBackup extends Construct {
  private readonly backupProject: Project;

  constructor(scope: Construct, id: string, props: S3CodeCommitBackupProps) {
    super(scope, id);

    const { backupBucket, schedule, computeType, repository } = props;

    const { repositoryName, repositoryCloneUrlHttp, repositoryArn } = repository;

    const buildImage = LinuxBuildImage.STANDARD_5_0;

    this.backupProject = new Project(this, 'BackupProject', {
      environment: {
        buildImage,
        computeType: computeType || buildImage.defaultComputeType,
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        env: {
          'git-credential-helper': 'yes',
        },
        phases: {
          pre_build: {
            commands: [
              `echo "[===== Clone repository: ${repositoryName} =====]"`,
              `git clone "${repositoryCloneUrlHttp}"`,
            ],
          },
          build: {
            commands: [
              "dt=$(date -u '+%Y_%m_%d_%H_%M')",
              `zipfile="${repositoryName}_backup_\${dt}_UTC.tar.gz"`,
              `echo "Compressing repository: ${repositoryName} into file: \${zipfile} and uploading to S3 bucket: ${backupBucket.bucketName}/${repositoryName}"`,
              `tar -zcvf "\${zipfile}" "${repositoryName}/"`,
              `aws s3 cp "\${zipfile}" "s3://${backupBucket.bucketName}/${repositoryName}/\${zipfile}"`,
            ],
          },
        },
      }),
    });

    backupBucket.grantPut(this.backupProject);

    this.backupProject.addToRolePolicy(
      new PolicyStatement({
        resources: [repositoryArn],
        actions: [
          'codecommit:BatchGet*',
          'codecommit:Get*',
          'codecommit:Describe*',
          'codecommit:List*',
          'codecommit:GitPull',
        ],
      }),
    );

    new Rule(this, 'ScheduleRule', {
      schedule,
      targets: [new CodeBuildProject(this.backupProject)],
    });
  }

  /**
   * Defines an event rule which triggers when a backup fails.
   */
  public onBackupFailed(id: string, options?: OnEventOptions): Rule {
    return this.backupProject.onBuildFailed(id, options);
  }

  /**
   * Defines an event rule which triggers when a backup starts.
   */
  public onBackupStarted(id: string, options?: OnEventOptions): Rule {
    return this.backupProject.onBuildStarted(id, options);
  }

  /**
   * Defines an event rule which triggers when a backup complets successfully.
   */
  public onBackupSucceeded(id: string, options?: OnEventOptions): Rule {
    return this.backupProject.onBuildSucceeded(id, options);
  }
}
