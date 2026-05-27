pipeline {
  agent {
    kubernetes {
      yamlFile '.jenkins/podspec.yaml'
    }
  }
  environment {
    IMAGE_REPO = 'huckleberry/huckleberry-bff'
    GIT_SHA    = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
  }
  options {
    timestamps()
    ansiColor('xterm')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }
  triggers {
    // Build automatically on every push to main
    githubPush()
  }
  stages {
    stage('Build & Push') {
      when {
        branch 'main'
      }
      steps {
        container('kaniko') {
          sh """
            /kaniko/executor \\
              --dockerfile Dockerfile \\
              --context dir://\${PWD} \\
              --destination=\$DEFAULT_DOCKER_REGISTRY/\$IMAGE_REPO:\$GIT_SHA \\
              --destination=\$DEFAULT_DOCKER_REGISTRY/\$IMAGE_REPO:\$GIT_SHA-\$BUILD_NUMBER \\
              --destination=\$DEFAULT_DOCKER_REGISTRY/\$IMAGE_REPO:latest \\
              --cache=true \\
              --cache-repo=\$DEFAULT_DOCKER_REGISTRY/\$IMAGE_REPO/cache
          """
        }
      }
    }
  }
  post {
    success {
      echo "Image published: \$DEFAULT_DOCKER_REGISTRY/\$IMAGE_REPO:\$GIT_SHA"
    }
  }
}
