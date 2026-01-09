PHONY: lint format test hooks

lint:
	cd backend && pipenv run ruff check .

format:
	cd backend && pipenv run ruff format .

test:
	cd backend && pipenv run pytest -q || [ $$? -eq 5 ]

hooks:
	cd backend && pipenv run pre-commit install
