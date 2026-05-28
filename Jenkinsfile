pipeline {
  agent none
  options {
    ansiColor('xterm')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timestamps()
  }
  environment {
    IMAGE_REPO = 'huckleberry/huckleberry-bff'
    GIT_SHA    = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
    fullImage  = "${DEFAULT_DOCKER_REGISTRY}/${IMAGE_REPO}"
  }
  triggers {
    githubPush()
  }
  stages {
    stage('Ensure ECR Repository') {
      when {
        branch 'main'
      }
      agent {
        kubernetes {
          yamlFile '.jenkins/podspec.yaml'
        }
      }
      steps {
        container('docker') {
          sh """
          aws ecr describe-repositories --repository-names ${IMAGE_REPO} --region us-east-1 &>/dev/null ||
          aws ecr create-repository --repository-name ${IMAGE_REPO} --region us-east-1 --image-tag-mutability MUTABLE --image-scanning-configuration scanOnPush=true
          """.stripIndent()
        }
      }
    }
    stage('Build & Push') {
      when {
        beforeAgent true
        branch 'main'
      }
      parallel {
        stage('linux/amd64') {
          agent {
            kubernetes {
              yamlFile '.jenkins/podspec.yaml'
            }
          }
          steps {
            container('buildah') {
              sh "buildah build -t ${fullImage}:${GIT_SHA}-amd64 ."
              sh "buildah push ${fullImage}:${GIT_SHA}-amd64"
            }
          }
        }
        stage('linux/arm64') {
          agent {
            kubernetes {
              yamlFile '.jenkins/podspec-arm.yaml'
            }
          }
          steps {
            container('buildah-arm') {
              sh "buildah build -t ${fullImage}:${GIT_SHA}-arm64 ."
              sh "buildah push ${fullImage}:${GIT_SHA}-arm64"
            }
          }
        }
      }
    }
    stage('Create Manifest') {
      when {
        branch 'main'
      }
      agent {
        kubernetes {
          yamlFile '.jenkins/podspec.yaml'
        }
      }
      steps {
        container('docker') {
          sh "docker manifest create ${fullImage}:${GIT_SHA} ${fullImage}:${GIT_SHA}-amd64 ${fullImage}:${GIT_SHA}-arm64"
          sh "docker manifest push ${fullImage}:${GIT_SHA}"
          sh "docker manifest create ${fullImage}:latest ${fullImage}:${GIT_SHA}-amd64 ${fullImage}:${GIT_SHA}-arm64"
          sh "docker manifest push ${fullImage}:latest"
        }
      }
    }
  }
}
