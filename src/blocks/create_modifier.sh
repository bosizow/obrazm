#!/bin/bash

# Проверяем, переданы ли два аргумента (имя блока и имя модификатора)
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Error: Specify block name and modifier name"
  echo "Example of use: ./create_modifier.sh uc-header fixed"
  exit 1
fi

BLOCK_NAME=$1
MODIFIER_NAME="_${2}"
MODIFIER_FILE_NAME="${BLOCK_NAME}${MODIFIER_NAME}" # Формат модификатора: block_modifier
MODIFIER_DIR="$BLOCK_NAME/${MODIFIER_NAME}"
BLOCK_SCSS="$BLOCK_NAME/$BLOCK_NAME.scss"
MODIFIER_SCSS="$MODIFIER_DIR/$MODIFIER_FILE_NAME.scss"

# Проверяем, существует ли блок
if [ ! -d "$BLOCK_NAME" ]; then
  echo "Block $BLOCK_NAME not found - creating a new one"
  ./create_block.sh "$BLOCK_NAME"
fi

# Проверяем, существует ли модификатор
if [ -d "$MODIFIER_DIR" ]; then
  echo "⚠️ Modifier $MODIFIER_FILE_NAME already exists in $BLOCK_NAME!"
  exit 1
fi

# Создаём папку для модификатора
mkdir -p "$MODIFIER_DIR"

# Создаём SCSS файл для модификатора
cat <<EOF > "$MODIFIER_SCSS"
.$MODIFIER_FILE_NAME {}
EOF

# Проверяем, существует ли SCSS-файл блока
if [ -f "$BLOCK_SCSS" ]; then
  # Добавляем `@use` в начало файла, если он ещё не добавлен
  if ! grep -q "@use \"$MODIFIER_NAME/$MODIFIER_FILE_NAME\";" "$BLOCK_SCSS"; then
    echo "@use \"$MODIFIER_NAME/$MODIFIER_FILE_NAME\";" | cat - "$BLOCK_SCSS" > temp && mv temp "$BLOCK_SCSS"
    echo "📌 SCSS @use added to $BLOCK_SCSS"
  else
    echo "⚠️ SCSS @use for $MODIFIER_FILE_NAME already exists in $BLOCK_SCSS"
  fi
else
  echo "❌ SCSS file $BLOCK_SCSS not found, skipping @use"
fi

echo "✅ Modifier $MODIFIER_FILE_NAME created in $BLOCK_NAME block"