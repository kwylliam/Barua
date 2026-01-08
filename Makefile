lint:
	cd backend && pipenv run ruff check .

format:
	cd backend && pipenv run ruff format .

test:
	cd backend && pipenv run pytest
