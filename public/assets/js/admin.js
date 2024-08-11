document.addEventListener("DOMContentLoaded", () => {
  // Handle the delete links
  const deleteLinks = document.querySelectorAll(".delete-link");
  deleteLinks.forEach((link) => {
    link.addEventListener("click", function (event) {
      event.preventDefault();

      const eventId = this.getAttribute("data-event");
      const itemId = this.getAttribute("data-item");
      const url = `/admin/item/delete?event=${eventId}&item=${itemId}`;

      if (confirm("Are you sure you want to delete this item?")) {
        // Redirect to the delete URL
        window.location.href = url;
      }
    });
  });

  // Handle the cancel links
  const cancelLinks = document.querySelectorAll(".cancel-link");
  cancelLinks.forEach((link) => {
    link.addEventListener("click", function (event) {
      event.preventDefault();

      const eventId = this.getAttribute("data-event");
      const signupId = this.getAttribute("data-signup");
      const url = `/admin/signup/delete?event=${eventId}&signup=${signupId}`;

      if (confirm("Are you sure you want to cancel this signup?")) {
        // Redirect to the delete URL
        window.location.href = url;
      }
    });
  });

  // Handle the kid table sorting
  const getCellValue = (tr, idx) =>
    tr.children[idx].innerText || tr.children[idx].textContent;

  const comparer = (idx, asc) => (a, b) =>
    ((v1, v2) =>
      v1 !== "" && v2 !== "" && !isNaN(v1) && !isNaN(v2)
        ? v1 - v2
        : v1.toString().localeCompare(v2))(
      getCellValue(asc ? a : b, idx),
      getCellValue(asc ? b : a, idx)
    );

  document.querySelectorAll("th.sortable").forEach((th) =>
    th.addEventListener("click", () => {
      const table = th.closest("table");
      const tbody = table.querySelector("tbody");
      Array.from(tbody.querySelectorAll("tr"))
        .sort(
          comparer(
            Array.from(th.parentNode.children).indexOf(th),
            (this.asc = !this.asc)
          )
        )
        .forEach((tr) => tbody.appendChild(tr));
    })
  );
});
