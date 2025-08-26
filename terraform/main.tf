provider "aws" {
  profile = "default"
  region  = "ap-southeast-2"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical's account ID

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_subnet" "public_subnet" {
  filter {
    name   = "tag:Name"
    values = ["aws-controltower-PublicSubnet2"]
  }
}

data "aws_security_group" "web_sg" {
  name = "CAB432SG"
}


resource "aws_instance" "app_server" {
  ami                  = data.aws_ami.ubuntu.id
  instance_type        = "t3.micro"
  subnet_id            = data.aws_subnet.public_subnet.id
  security_groups      = [data.aws_security_group.web_sg.id]
  iam_instance_profile = "CAB432-Instance-Role"
  key_name             = "n10869000-key"
  metadata_options {
    http_endpoint           = "enabled"
    http_tokens             = "required"
    http_put_response_hop_limit = 1
  }
  tags = {
    Name        = "ExistentialCalculator"
    Environment = "qut-username"
    qut-username = "n1086900@qut.edu.au"
  }
  user_data_replace_on_change = true
  user_data = <<-EOF
              #!/bin/bash
              set -e
              
              apt-get update -y
              apt-get install -y docker.io awscli
              systemctl start docker
              systemctl enable docker
              
              # Login to ECR using IAM role permissions
              aws ecr get-login-password --region ap-southeast-2 | sudo docker login --username AWS --password-stdin 901444280953.dkr.ecr.ap-southeast-2.amazonaws.com
              
              sudo docker network create my-app-network
              sudo docker run -d --network my-app-network -p 6379:6379 --name redis redis:latest
              
              sudo docker run -d --network my-app-network -p 80:3001 --name existential_calculator_container \
                -e NODE_ENV=production \
                901444280953.dkr.ecr.ap-southeast-2.amazonaws.com/existential-calculator-repo:latest
            EOF
}

output "instance_ip" {
  value = aws_instance.app_server.public_ip
}
