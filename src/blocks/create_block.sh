#!/bin/bash

# Проверяем, переданы ли аргументы (названия блоков)
if [ "$#" -eq 0 ]; then
  echo "Error: Specify at least one block name"
  echo "Example: ./create_block.sh block1:block1__element1,block1__element2:block1_modifier1 block2:block2__element1"
  exit 1
fi

# Перебираем переданные аргументы (названия блоков и их элементов/модификаторов)
for BLOCK_ARG in "$@"; do
  # Разделяем имя блока и его элементы/модификаторы
  IFS=':' read -r BLOCK_NAME ELEMENTS_MODIFIERS <<<"$BLOCK_ARG"

  # Создаем папку для блока
  mkdir -p "$BLOCK_NAME"

  # Создаем файл docs.html с описанием блока
  cat <<EOF >"$BLOCK_NAME/$BLOCK_NAME.docs.html"
<!-- 
 
Код для блока << название блока >>

---

Описание: << описание >>

---

Блок Tilda: << номер блока >>
CSS класс: .$BLOCK_NAME
Дата создания: $(date +"%d/%m/%Y")

-->
EOF

# Создаем файл .scss с селектором блока
  cat <<EOF >"$BLOCK_NAME/$BLOCK_NAME.scss"
.$BLOCK_NAME {}
EOF

  # Создаем файлы блока
  touch "$BLOCK_NAME/$BLOCK_NAME.html"
  touch "$BLOCK_NAME/$BLOCK_NAME.js"
  mkdir "$BLOCK_NAME/assets"

  echo "$BLOCK_NAME block is created"

  # Если у блока есть элементы или модификаторы
  if [ -n "$ELEMENTS_MODIFIERS" ]; then
    # Разделяем элементы и модификаторы по запятой
    IFS=',' read -ra ITEMS <<<"$ELEMENTS_MODIFIERS"

    for ITEM in "${ITEMS[@]}"; do
      # Проверяем, является ли это элементом или модификатором
      if [[ "$ITEM" == *"__"* ]]; then
        # Это элемент
        ./create_element.sh $BLOCK_NAME $ITEM
      elif [[ "$ITEM" == *"_"* ]]; then
        # Это модификатор
        ./create_modifier.sh $BLOCK_NAME $ITEM
      fi
    done
  fi
done

echo "All blocks, elements and modifiers have been successfully created"
