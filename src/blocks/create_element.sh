#!/bin/bash

# Проверяем, переданы ли два аргумента (имя блока и имя элемента)
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Error: Specify block name and element name"
  echo "Example of use: ./create_element.sh uc-header menu"
  exit 1
fi

BLOCK_NAME=$1
ELEMENT_NAME="__${2}"
ELEMENT_FILE_NAME="${BLOCK_NAME}${ELEMENT_NAME}"
ELEMENT_DIR="$BLOCK_NAME/${ELEMENT_NAME}"
BLOCK_SCSS="$BLOCK_NAME/$BLOCK_NAME.scss"
ELEMENT_SCSS="$ELEMENT_DIR/${ELEMENT_FILE_NAME}.scss"

# Проверяем, существует ли блок
if [ ! -d "$BLOCK_NAME" ]; then
  echo "Block $BLOCK_NAME not found - creating a new one"
  ./create_block.sh "$BLOCK_NAME"
fi

# Проверяем, существует ли элемент
if [ -d "$ELEMENT_DIR" ]; then
  echo "⚠️ Modifier $ELEMENT_DIR already exists in $BLOCK_NAME!"
  exit 1
fi

# Создаём папку для элемента
mkdir -p "$ELEMENT_DIR"

# Создаём SCSS файл для элемента
cat <<EOF > "$ELEMENT_SCSS"
.$ELEMENT_FILE_NAME {}
EOF

# Создаём JS файл для элемента
touch "$ELEMENT_DIR/${ELEMENT_FILE_NAME}.js"

# Проверяем, существует ли SCSS-файл блока
if [ -f "$BLOCK_SCSS" ]; then
  # Добавляем импорт в начало файла, если он ещё не добавлен
  if ! grep -q "@use \"$ELEMENT_NAME/$ELEMENT_FILE_NAME\";" "$BLOCK_SCSS"; then
    echo "@use \"$ELEMENT_NAME/$ELEMENT_FILE_NAME\";" | cat - "$BLOCK_SCSS" > temp && mv temp "$BLOCK_SCSS"
    echo "📌 use added to $BLOCK_SCSS"
  else
    echo "⚠️ use for $ELEMENT_FILE_NAME already exists in $BLOCK_SCSS"
  fi
else
  echo "❌ SCSS file $BLOCK_SCSS not found, skipping use"
fi

echo "✅ ${ELEMENT_FILE_NAME} element is created in the $BLOCK_NAME block"