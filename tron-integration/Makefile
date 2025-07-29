# 1inch Fusion Plus Tron Integration Makefile
# Simplifies testing, deployment, and development workflows

.PHONY: help install compile test test-unit test-integration test-verbose clean deploy-dev deploy-shasta deploy-nile deploy-mainnet lint format

# Default target
help:
	@echo "🚀 1inch Fusion Plus Tron Integration Commands"
	@echo "=============================================="
	@echo ""
	@echo "📦 Setup:"
	@echo "  make install      Install dependencies"
	@echo "  make compile      Compile smart contracts"
	@echo ""
	@echo "🧪 Testing:"
	@echo "  make test         Run complete test suite"
	@echo "  make test-unit    Run unit tests only"
	@echo "  make test-integration  Run integration tests only"
	@echo "  make test-verbose Run tests with verbose output"
	@echo "  make test-clean   Clean build and run tests"
	@echo ""
	@echo "🚀 Deployment:"
	@echo "  make deploy-dev   Deploy to development network"
	@echo "  make deploy-shasta Deploy to Shasta testnet"
	@echo "  make deploy-nile  Deploy to Nile testnet"
	@echo "  make deploy-mainnet Deploy to mainnet (⚠️ CAUTION)"
	@echo ""
	@echo "🔧 Development:"
	@echo "  make clean        Clean build artifacts"
	@echo "  make lint         Run Solidity linter"
	@echo "  make format       Format code"
	@echo "  make verify       Verify deployed contracts"
	@echo ""
	@echo "📊 Analysis:"
	@echo "  make coverage     Run test coverage analysis"
	@echo "  make gas-report   Generate gas usage report"
	@echo ""

# Setup and dependencies
install:
	@echo "📦 Installing dependencies..."
	npm install
	@echo "✅ Dependencies installed"

compile:
	@echo "🔨 Compiling smart contracts..."
	npm run compile
	@echo "✅ Contracts compiled"

# Testing commands
test:
	@echo "🧪 Running complete test suite..."
	npm test

test-unit:
	@echo "🧪 Running unit tests..."
	npm run test:unit

test-integration:
	@echo "🧪 Running integration tests..."
	npm run test:integration

test-verbose:
	@echo "🧪 Running tests with verbose output..."
	npm run test:verbose

test-clean: clean compile test

coverage:
	@echo "📊 Generating test coverage report..."
	npm run test:coverage

# Deployment commands
deploy-dev:
	@echo "🚀 Deploying to development network..."
	npm run deploy:development

deploy-shasta:
	@echo "🚀 Deploying to Shasta testnet..."
	@echo "⚠️  Make sure you have test TRX in your account"
	npm run deploy:shasta

deploy-nile:
	@echo "🚀 Deploying to Nile testnet..."
	@echo "⚠️  Make sure you have test TRX in your account"
	npm run deploy:nile

deploy-mainnet:
	@echo "🚀 Deploying to MAINNET..."
	@echo "⚠️  ⚠️  WARNING: This will deploy to MAINNET! ⚠️  ⚠️"
	@echo "⚠️  Make sure you have real TRX and have tested thoroughly!"
	@read -p "Are you sure? Type 'yes' to continue: " confirm; \
	if [ "$$confirm" = "yes" ]; then \
		npm run deploy:mainnet; \
	else \
		echo "❌ Deployment cancelled"; \
	fi

# Development tools
clean:
	@echo "🧹 Cleaning build artifacts..."
	npm run clean
	@echo "✅ Build artifacts cleaned"

lint:
	@echo "🔍 Running Solidity linter..."
	npm run lint

format:
	@echo "✨ Formatting code..."
	npm run format

verify:
	@echo "🔍 Verifying deployed contracts..."
	npm run verify

# Analysis and reporting
gas-report:
	@echo "⛽ Generating gas usage report..."
	@echo "Running tests with gas reporting..."
	tronbox test --reporter eth-gas-reporter

# Quick development workflow
dev-setup: install compile test
	@echo "🎉 Development environment ready!"

# Full CI/CD workflow simulation
ci: clean install compile lint test
	@echo "🎉 CI/CD pipeline completed successfully!"

# Emergency commands
emergency-clean:
	@echo "🚨 Emergency cleanup..."
	rm -rf node_modules build .nyc_output
	npm install
	@echo "✅ Emergency cleanup completed"

# Network status checks
check-networks:
	@echo "🌐 Checking network configurations..."
	@echo "Development network:"
	@tronbox networks | grep development || echo "❌ Development network not configured"
	@echo "Shasta testnet:"
	@tronbox networks | grep shasta || echo "❌ Shasta network not configured"
	@echo "Nile testnet:"
	@tronbox networks | grep nile || echo "❌ Nile network not configured"

# Contract size analysis
contract-size:
	@echo "📏 Analyzing contract sizes..."
	@if [ -d "build/contracts" ]; then \
		echo "Contract sizes (bytecode):"; \
		for file in build/contracts/*.json; do \
			if [ -f "$$file" ]; then \
				name=$$(basename "$$file" .json); \
				size=$$(jq -r '.bytecode' "$$file" | wc -c); \
				if [ "$$size" -gt 2 ]; then \
					echo "  $$name: $$((size/2)) bytes"; \
				fi; \
			fi; \
		done; \
	else \
		echo "❌ No build directory found. Run 'make compile' first."; \
	fi

# Performance testing
perf-test:
	@echo "⚡ Running performance tests..."
	@echo "This may take several minutes..."
	npm run test:integration

# Documentation generation
docs:
	@echo "📚 Generating documentation..."
	@if command -v solidity-docgen >/dev/null 2>&1; then \
		solidity-docgen --solc-module solc --input contracts --output docs; \
		echo "✅ Documentation generated in docs/"; \
	else \
		echo "❌ solidity-docgen not installed. Install with: npm install -g solidity-docgen"; \
	fi

# Security analysis
security-check:
	@echo "🔒 Running security analysis..."
	@if command -v slither >/dev/null 2>&1; then \
		slither contracts/; \
	else \
		echo "❌ Slither not installed. Install with: pip install slither-analyzer"; \
	fi

# Environment validation
validate-env:
	@echo "✅ Validating environment..."
	@node --version | grep -q "v1[6789]" && echo "✅ Node.js version OK" || echo "❌ Node.js version should be >= 16"
	@npm --version | grep -q "[89]" && echo "✅ npm version OK" || echo "❌ npm version should be >= 8"
	@tronbox --version >/dev/null 2>&1 && echo "✅ TronBox installed" || echo "❌ TronBox not installed"
	@echo "Environment validation complete"

# Backup and restore
backup:
	@echo "💾 Creating backup..."
	@timestamp=$$(date +%Y%m%d_%H%M%S); \
	tar -czf "backup_$$timestamp.tar.gz" contracts migrations test tronbox-config.js package.json; \
	echo "✅ Backup created: backup_$$timestamp.tar.gz"

# All-in-one commands for common workflows
quick-test: compile test-unit
	@echo "⚡ Quick test completed"

full-test: clean compile test
	@echo "🧪 Full test suite completed"

deploy-test: compile deploy-dev test
	@echo "🚀 Deploy and test completed" 