import { BuildSpec, LinuxBuildImage, Project, ComputeType, Cache, LocalCacheMode } from 'aws-cdk-lib/aws-codebuild';
import { IRepository } from 'aws-cdk-lib/aws-codecommit';
import { Rule, Schedule, OnEventOptions } from 'aws-cdk-lib/aws-events';
import { CodeBuildProject } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

import { Cli, ScanProps } from './cli';

export interface CodeCommitDependencyCheckProps {
  /**
   * The repository to be checked
   */
  readonly repository: IRepository;

  /**
   * Schedule for dependency check.
   */
  readonly schedule: Schedule;

  /**
   * The type of compute to use for check the repositories.
   * See the {@link ComputeType} enum for the possible values.
   *
   * @default taken from {@link #buildImage#defaultComputeType}
   */
  readonly computeType?: ComputeType;

  /**
   * Custom command to be executed before the dependency check
   *
   * @default `echo "No preCheckCommand!"`
   */
  readonly preCheckCommand?: string;

  /**
   * Version of the dependency check
   *
   * @default 5.3.2
   */
  readonly version?: string;

  /**
   * The name of the project being scanned.
   *
   * * @default taken from {@link #repository#repositoryName}
   */
  readonly projectName?: ScanProps['projectName'];

  /**
   * If the score set between 0 and 10 the exit code from dependency-check will indicate if a vulnerability with a CVSS score equal to or higher was identified.
   *
   * @default 0
   */
  readonly failOnCVSS?: ScanProps['failOnCVSS'];

  /**
   * The paths to scan. Basedir repositoryDir
   *
   * @default the repositoryDir
   */
  readonly paths?: string[];

  /**
   * The path patterns to exclude from the scan
   */
  readonly excludes?: string[];

  /**
   * The file paths to the suppression XML files; used to suppress false positives.
   */
  readonly suppressions?: string[];

  /**
   * Enable the experimental analyzers. If not set the analyzers marked as experimental will not be loaded or used.
   *
   * @default false
   */
  readonly enableExperimental?: boolean;

  /**
   * Bucket for uploading html reports
   */
  readonly reportsBucket?: Bucket;
}

export class CodeCommitDependencyCheck extends Construct {
  private readonly checkProject: Project;

  constructor(scope: Construct, id: string, props: CodeCommitDependencyCheckProps) {
    super(scope, id);

    const {
      schedule,
      computeType,
      repository,
      preCheckCommand = 'echo "No preCheckCommand!"',
      version = '5.3.2',
      projectName,
      failOnCVSS = 0,
      paths = ['.'],
      excludes,
      suppressions,
      enableExperimental,
      reportsBucket,
    } = props;

    const { repositoryName, repositoryCloneUrlHttp, repositoryArn } = repository;

    const buildImage = LinuxBuildImage.STANDARD_2_0;

    const dependencyCheck = `dependency-check-${version}-release`;

    const cli = new Cli();

    this.checkProject = new Project(this, 'CheckProject', {
      cache: Cache.local(LocalCacheMode.CUSTOM),
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
          install: {
            commands: [
              'echo "[===== Install OWASP Dependency Check =====]"',
              'wget -O public-key.asc https://bintray.com/user/downloadSubjectPublicKey?username=jeremy-long',
              'gpg --keyid-format long --list-options show-keyring public-key.asc',
              'gpg --import public-key.asc',
              `wget https://dl.bintray.com/jeremy-long/owasp/${dependencyCheck}.zip`,
              `wget https://dl.bintray.com/jeremy-long/owasp/${dependencyCheck}.zip.asc`,
              `gpg --verify ${dependencyCheck}.zip.asc ${dependencyCheck}.zip`,
              `unzip ${dependencyCheck}.zip -d /opt`,
              'chmod +x /opt/dependency-check/bin/dependency-check.sh',
              'export PATH="$PATH:/opt/dependency-check/bin"',
            ],
          },
          pre_build: {
            commands: [
              `echo "[===== Clone repository: ${repositoryName} =====]"`,
              `git clone "${repositoryCloneUrlHttp}"`,
              `cd ${repositoryName}`,
              `${preCheckCommand}`,
              'SHA=$(git rev-parse HEAD)',
              'cd ${CODEBUILD_SRC_DIR}',
            ],
          },
          build: {
            commands: [
              `echo "[===== Scan repository: ${repositoryName} =====]"`,
              'echo "[===== SHA: $SHA =====]"',
              'mkdir reports',
              cli.version(),
              cli.scan({
                projectName: projectName || repositoryName,
                basedir: repositoryName,
                paths,
                failOnCVSS,
                enableExperimental,
                suppressions,
                excludes,
              }),
            ],
            finally: [
              'echo "[===== Upload reports =====]"',
              "dt=$(date -u '+%Y_%m_%d_%H_%M')",
              reportsBucket
                ? `aws s3 cp reports/dependency-check-report.html s3://${reportsBucket.bucketName}/${repositoryName}/\${dt}_UTC/`
                : 'echo "No reportsBuckets"',
            ],
          },
        },
        reports: {
          dependencyCheckReport: {
            files: ['reports/dependency-check-junit.xml'],
          },
        },
        cache: {
          paths: ['/opt/dependency-check/data/**/*'],
        },
      }),
    });

    this.checkProject.addToRolePolicy(
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

    if (reportsBucket) {
      reportsBucket.grantWrite(this.checkProject);
    }

    new Rule(this, 'ScheduleRule', {
      schedule,
      targets: [new CodeBuildProject(this.checkProject)],
    });
  }

  /**
   * Defines an event rule which triggers when a check fails.
   */
  public onCheckFailed(id: string, options?: OnEventOptions): Rule {
    return this.checkProject.onBuildFailed(id, options);
  }

  /**
   * Defines an event rule which triggers when a check starts.
   */
  public onCheckStarted(id: string, options?: OnEventOptions): Rule {
    return this.checkProject.onBuildStarted(id, options);
  }

  /**
   * Defines an event rule which triggers when a check complets successfully.
   */
  public onCheckSucceeded(id: string, options?: OnEventOptions): Rule {
    return this.checkProject.onBuildSucceeded(id, options);
  }
}
