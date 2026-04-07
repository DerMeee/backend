// Backend-only deployment repo: build/push Nest API image, then Ansible (from this repo).
// Frontend lives in another org repo — use its own pipeline to push dermeee-frontend.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  // Prefer: Manage Jenkins → System → Global properties → Environment variables → DOCKER_REGISTRY
  // Fallback avoids empty registry when global property is not set (same value as your GHCR namespace).
  environment {
    DOCKER_REGISTRY = "${env.DOCKER_REGISTRY?.trim() ?: 'ghcr.io/morsiyoucef-alter'}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.IMAGE_TAG = sh(
            returnStdout: true,
            script: 'git rev-parse --short=7 HEAD',
          ).trim()
          env.API_IMAGE = "${env.DOCKER_REGISTRY}/dermeee-api"
        }
      }
    }

    stage('Validate registry') {
      steps {
        script {
          if (!env.DOCKER_REGISTRY?.trim()) {
            error('Set Jenkins job environment variable DOCKER_REGISTRY (e.g. ghcr.io/myorg).')
          }
        }
      }
    }

    stage('Docker login') {
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: 'docker-registry-credentials',
            usernameVariable: 'REG_USER',
            passwordVariable: 'REG_PASS',
          ),
        ]) {
          sh 'echo "$REG_PASS" | docker login "$DOCKER_REGISTRY" -u "$REG_USER" --password-stdin'
        }
      }
    }

    stage('Build & push API') {
      steps {
        sh """
          docker build -t ${env.API_IMAGE}:${env.IMAGE_TAG} -t ${env.API_IMAGE}:latest .
          docker push ${env.API_IMAGE}:${env.IMAGE_TAG}
          docker push ${env.API_IMAGE}:latest
        """
      }
    }

    stage('Deploy with Ansible') {
      when {
        anyOf {
          branch 'main'
          branch 'master'
        }
      }
      steps {
        sshagent(credentials: ['vps-ssh-deploy-key']) {
          sh """
            cd deploy/ansible
            ansible-playbook \\
              -i inventory/jenkins.ini \\
              playbooks/deploy.yml \\
              -e image_tag=${env.IMAGE_TAG}
          """
        }
      }
    }
  }

  post {
    always {
      sh 'docker logout "$DOCKER_REGISTRY" 2>/dev/null || true'
    }
  }
}
