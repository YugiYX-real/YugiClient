import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app/App.tsx"
import "./styles/global.css"

const container = document.getElementById("root")

if (container === null) {
	throw new Error("Root container is missing from the document")
}

for (const event of ["dragover", "drop"] as const) {
	window.addEventListener(event, (nativeEvent) => {
		nativeEvent.preventDefault()
	})
}

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
