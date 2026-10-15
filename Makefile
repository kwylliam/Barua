PYTHON := .venv/bin/python
RUFF := .venv/bin/ruff
PRE_COMMIT := .venv/bin/pre-commit
PRE_COMMIT_HOME := $(CURDIR)/.pre-commit-cache

.PHONY: runserver lint format test test-crypto build-crypto migrate makemigrations cleanup-letters pre-commit-install

runserver:
	$(PYTHON) manage.py runserver

lint:
	$(RUFF) check .

format:
	$(RUFF) format .

test:
	$(PYTHON) manage.py test

test-crypto:
	npm run test:crypto

build-crypto:
	npm run build:crypto

migrate:
	$(PYTHON) manage.py migrate

makemigrations:
	$(PYTHON) manage.py makemigrations

cleanup-letters:
	$(PYTHON) manage.py cleanup_letters

pre-commit-install:
	PRE_COMMIT_HOME=$(PRE_COMMIT_HOME) $(PRE_COMMIT) install
