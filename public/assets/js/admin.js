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

  // Handle the CSV file generation
  document.querySelectorAll(".download-csv").forEach((link) => {
    console.log("got link", link);
    link.addEventListener("click", function (e) {
      e.preventDefault();

      const tableId = this.getAttribute("data-table-id");
      const table = document.getElementById(tableId);
      console.log("got table", table);
      const rows = Array.from(table.querySelectorAll("tr"));
      const csvContent = rows
        .map((row) => {
          const cols = Array.from(row.querySelectorAll("th, td"));
          return cols
            .map((col) => `"${col.innerText.replace(/"/g, '""')}"`)
            .join(",");
        })
        .join("\n");
      console.log("got csv content", csvContent);

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const downloadLink = document.createElement("a");
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = `${tableId}-data.csv`;
      downloadLink.style.display = "none";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    });
  });

  // Handle toggling hide/show of sections
  document.querySelectorAll(".toggle-section").forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();

      const sectionId = this.getAttribute("data-section-id");
      const section = document.getElementById(sectionId);

      if (section.style.display === "none") {
        section.style.display = "block";
      } else {
        section.style.display = "none";
      }
    });
  });
});
