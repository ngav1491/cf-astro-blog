const zhDateFormatter = new Intl.DateTimeFormat("zh-CN", {
	year: "numeric",
	month: "long",
	day: "numeric",
});

export function formatDate(date: string | Date) {
	const value = typeof date === "string" ? new Date(date) : date;

	return zhDateFormatter.format(value);
}
