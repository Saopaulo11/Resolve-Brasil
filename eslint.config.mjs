import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src/generated/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Корневая точка входа для Vercel — CommonJS-файл на обычном Node:
    // правила для модулей TypeScript здесь дают ложные ошибки.
    files: ["server.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "writable",
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Скрипты из public/ выполняются в браузере, а не в Node: там другие
    // глобальные объекты, и правила Node давали бы ложные ошибки.
    files: ["public/js/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        window: "readonly",
        URL: "readonly",
        DataTransfer: "readonly",
        Image: "readonly",
      },
    },
  },
);
