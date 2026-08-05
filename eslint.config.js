import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
	{
		ignores: [
			"**/node_modules/**",
			"out/**",
			"release/**",
			"dist/**",
			"coverage/**",
			"build/**",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
			],
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{ prefer: "type-imports", fixStyle: "separate-type-imports" },
			],
			"@typescript-eslint/no-explicit-any": "error",
			eqeqeq: ["error", "always"],
			"no-var": "error",
			"prefer-const": "error",
			"object-shorthand": ["error", "always"],
		},
	},
	{
		files: ["**/*.mjs", "**/*.js"],
		rules: {
			"no-undef": "off",
		},
	},
)
