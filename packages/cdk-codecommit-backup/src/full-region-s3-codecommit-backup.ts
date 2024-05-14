import * as path from 'path';
import { BuildSpec, ComputeType, LinuxBuildImage, Project } from 'aws-cdk-lib/aws-codebuild';
import { OnEventOptions, Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { CodeBuildProject } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';

const S3_BUCKET_ENV = 'SCRIPTS_BUCKET';
const S3_KEY_ENV = 'SCRIPTS_BUCKET_KEY';

export interface FullRegionS3CodeCommitBackupProps {
  /**
   * Bucket for storing the backups.
   */
  readonly backupBucket: Bucket;

  /**
   * Schedule for backups.
   */
  readonly schedule: Schedule;

  /**
   * The names of the repositories in the region to be backed up.
   *
   * @default - All repositories in the region
   */
  readonly repositoryNames?: string[];

  /**
   * The type of compute to use for backup the repositories.
   * See the {@link ComputeType} enum for the possible values.
   *
   * @default taken from {@link #buildImage#defaultComputeType}
   */
  readonly computeType?: ComputeType;
}

export class FullRegionS3CodeCommitBackup extends Construct {
  private readonly backupProject: Project;

  constructor(scope: Construct, id: string, props: FullRegionS3CodeCommitBackupProps) {
    super(scope, id);

    const { backupBucket, schedule, repositoryNames = [], computeType } = props;

    const asset = new Asset(this, 'ScriptsDirectory', {
      path: path.join(__dirname, '..', 'scripts'),
    });

    const buildImage = LinuxBuildImage.STANDARD_5_0;

    this.backupProject = new Project(this, 'FullRegionBackupProject', {
      environment: {
        buildImage,
        computeType: computeType || buildImage.defaultComputeType,
      },
      environmentVariables: {
        BACKUP_BUCKET: {
          value: backupBucket.bucketName,
        },
        REPOSITORY_NAMES: {
          value: repositoryNames.join(' '),
        },
        [S3_BUCKET_ENV]: { value: asset.s3BucketName },
        [S3_KEY_ENV]: { value: asset.s3ObjectKey },
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        env: {
          'git-credential-helper': 'yes',
        },
        phases: {
          pre_build: {
            commands: [
              `echo "Downloading scripts from s3://\${${S3_BUCKET_ENV}}/\${${S3_KEY_ENV}}"`,
              `aws s3 cp s3://\${${S3_BUCKET_ENV}}/\${${S3_KEY_ENV}} ./`,
              `unzip ./$(basename \${${S3_KEY_ENV}})`,
            ],
          },
          build: {
            commands: ['chmod +x backup_codecommit.sh', './backup_codecommit.sh'],
          },
        },
      }),
    });

    asset.grantRead(this.backupProject);

    backupBucket.grantPut(this.backupProject);

    this.backupProject.addToRolePolicy(
      new PolicyStatement({
        resources: ['*'],
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
