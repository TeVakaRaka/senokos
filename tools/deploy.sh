#!/bin/sh
# Публикация игры на GitHub Pages: https://tevakaraka.github.io/senokos/
# Собирает игру и кладёт сборку в ветку gh-pages.
# Запуск: npm run deploy
set -e
cd "$(dirname "$0")/.."

npm test --silent
npm run build --silent
touch dist/.nojekyll

cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name)" -c user.email="$(git -C .. config user.email)" \
  commit -q -m "Сборка игры ($(git -C .. rev-parse --short HEAD))"
git push -q -f "$(git -C .. remote get-url origin)" gh-pages
rm -rf .git
echo "Опубликовано. Через минуту обновится https://tevakaraka.github.io/senokos/"
