const checkbox = document.getElementById("checkbox");

if (localStorage.getItem("theme") === "dark") {
	document.body.classList.add("dark");
	checkbox.checked = true;
}

checkbox.addEventListener("change", () => {
	const isDark = document.body.classList.toggle("dark");
	localStorage.setItem("theme", isDark ? "dark" : "light");
});

var btn = $('#back-to-top');

$(window).scroll(function() {
	if ($(window).scrollTop() > 300) {
		btn.addClass('show');
	} else {
		btn.removeClass('show');
	}
});

btn.on('click', function(e) {
  	e.preventDefault();
  	$('html, body').animate({scrollTop:0}, '800');
});

