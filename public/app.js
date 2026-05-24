const form = document.querySelector("#search-form");
const resultsBody = document.querySelector("#results");
const summary = document.querySelector("#summary");
const adminOpen = document.querySelector("#admin-open");
const searchView = document.querySelector("#search-view");
const adminView = document.querySelector("#admin-view");
const adminLoginForm = document.querySelector("#admin-login-form");
const adminLogout = document.querySelector("#admin-logout");
const adminStatus = document.querySelector("#admin-status");
const adminList = document.querySelector("#admin-list");
const adminResults = document.querySelector("#admin-results");
const addMemberOpen = document.querySelector("#add-member-open");
const addMemberModal = document.querySelector("#add-member-modal");
const addMemberForm = document.querySelector("#add-member-form");
const addMemberClose = document.querySelector("#add-member-close");
const addMemberCancel = document.querySelector("#add-member-cancel");
const addMemberMessage = document.querySelector("#add-member-message");
const saturdayCount = document.querySelector("#saturday-count");
const sundayCount = document.querySelector("#sunday-count");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEmpty(message) {
  resultsBody.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(message)}</td></tr>`;
}

function renderResults(results) {
  if (results.length === 0) {
    renderEmpty("일치하는 신청자가 없습니다.");
    return;
  }

  resultsBody.innerHTML = results
    .map(
      (person) => `
        <tr>
          <td>${escapeHtml(person.name)}</td>
          <td>${escapeHtml(person.phone)}</td>
          <td>${escapeHtml(person.className)}</td>
          <td>${escapeHtml(person.date)}</td>
          <td>${escapeHtml(person.email)}</td>
        </tr>
      `
    )
    .join("");
}

function setView(view) {
  const isAdmin = view === "admin";
  searchView.classList.toggle("hidden", isAdmin);
  adminView.classList.toggle("hidden", !isAdmin);
  adminOpen.textContent = isAdmin ? "검색 화면" : "관리자";

  if (isAdmin) {
    adminView.scrollIntoView({ block: "start" });
  } else {
    searchView.scrollIntoView({ block: "start" });
  }
}

function setLoggedIn(loggedIn) {
  adminLoginForm.classList.toggle("hidden", loggedIn);
  adminLogout.classList.toggle("hidden", !loggedIn);
  addMemberOpen.classList.toggle("hidden", !loggedIn);
  adminList.classList.toggle("hidden", !loggedIn);
}

function renderSummary(summary) {
  saturdayCount.textContent = `${summary.saturday || 0}명`;
  sundayCount.textContent = `${summary.sunday || 0}명`;
}

function renderAdminRows(results) {
  if (results.length === 0) {
    adminResults.innerHTML = `<tr><td colspan="6" class="empty">저장된 데이터가 없습니다.</td></tr>`;
    return;
  }

  adminResults.innerHTML = results
    .map(
      (person) => `
        <tr>
          <td>${escapeHtml(person.name)}</td>
          <td>${escapeHtml(person.phone)}</td>
          <td>${escapeHtml(person.className)}</td>
          <td>
            <select
              class="date-select"
              data-original-date="${escapeHtml(person.date)}"
              aria-label="${escapeHtml(person.name)} 참여날짜"
            >
              <option value="30일(토)" ${person.date === "30일(토)" ? "selected" : ""}>30일(토)</option>
              <option value="31일(일)" ${person.date === "31일(일)" ? "selected" : ""}>31일(일)</option>
            </select>
          </td>
          <td>${escapeHtml(person.email)}</td>
          <td>
            <button class="row-save" type="button" data-id="${escapeHtml(person.id)}" disabled>저장</button>
          </td>
        </tr>
      `
    )
    .join("");
}

async function loadAdminList() {
  adminStatus.textContent = "목록을 불러오는 중...";

  const response = await fetch("/api/admin/list");
  if (!response.ok) {
    setLoggedIn(false);
    adminStatus.textContent = "로그인이 필요합니다.";
    return;
  }

  const data = await response.json();
  setLoggedIn(true);
  renderSummary(data.summary);
  renderAdminRows(data.results);
  adminStatus.textContent = `전체 ${data.total}명`;
}

async function checkAdminSession() {
  const response = await fetch("/api/admin/me");
  const data = await response.json();
  if (data.loggedIn) {
    setLoggedIn(true);
    await loadAdminList();
  } else {
    setLoggedIn(false);
  }
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const params = new URLSearchParams();
    const name = formData.get("name").trim();
    const phone = formData.get("phone").trim();

    if (!name && !phone) {
      summary.textContent = "이름이나 전화번호를 입력해 주세요.";
      renderEmpty("검색어를 입력하면 결과가 표시됩니다.");
      return;
    }

    params.set("name", name);
    params.set("phone", phone);
    summary.textContent = "검색 중...";

    try {
      const response = await fetch(`/api/search?${params.toString()}`);
      const data = await response.json();
      summary.textContent = `전체 ${data.total}명 중 ${data.count}명`;
      renderResults(data.results);
    } catch (error) {
      summary.textContent = "검색 중 오류가 발생했습니다.";
      renderEmpty("서버 상태를 확인해 주세요.");
    }
  });
}

if (adminOpen && adminView) {
  adminOpen.addEventListener("click", async () => {
    if (adminView.classList.contains("hidden")) {
      setView("admin");
      await checkAdminSession();
    } else {
      setView("search");
    }
  });
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(adminLoginForm);
  adminStatus.textContent = "로그인 중...";

  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: formData.get("username").trim(),
      password: formData.get("password")
    })
  });

  const data = await response.json();
  if (!response.ok) {
    adminStatus.textContent = data.message || "로그인에 실패했습니다.";
    return;
  }

  adminLoginForm.reset();
  document.querySelector("#admin-username").value = "admin";
  await loadAdminList();
});

adminLogout.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  setLoggedIn(false);
  adminStatus.textContent = "로그아웃되었습니다.";
  adminResults.innerHTML = "";
});

function openAddMemberModal() {
  addMemberForm.reset();
  addMemberMessage.textContent = "";
  addMemberModal.classList.remove("hidden");
  addMemberForm.elements.name.focus();
}

function closeAddMemberModal() {
  addMemberModal.classList.add("hidden");
}

addMemberOpen.addEventListener("click", openAddMemberModal);
addMemberClose.addEventListener("click", closeAddMemberModal);
addMemberCancel.addEventListener("click", closeAddMemberModal);
addMemberModal.addEventListener("click", (event) => {
  if (event.target === addMemberModal) {
    closeAddMemberModal();
  }
});

addMemberForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(addMemberForm);
  addMemberMessage.textContent = "저장 중...";

  const response = await fetch("/api/admin/participant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: formData.get("name").trim(),
      phone: formData.get("phone").trim(),
      className: formData.get("className").trim(),
      date: formData.get("date"),
      email: formData.get("email").trim()
    })
  });

  const data = await response.json();
  if (!response.ok) {
    addMemberMessage.textContent = data.message || "회원 추가에 실패했습니다.";
    return;
  }

  closeAddMemberModal();
  adminStatus.textContent = "회원이 추가되었습니다.";
  await loadAdminList();
});

adminResults.addEventListener("change", async (event) => {
  if (!event.target.matches(".date-select")) {
    return;
  }

  const select = event.target;
  const row = select.closest("tr");
  const saveButton = row.querySelector(".row-save");
  saveButton.disabled = select.value === select.dataset.originalDate;
});

adminResults.addEventListener("click", async (event) => {
  if (!event.target.matches(".row-save")) {
    return;
  }

  const saveButton = event.target;
  const row = saveButton.closest("tr");
  const select = row.querySelector(".date-select");

  select.disabled = true;
  saveButton.disabled = true;
  adminStatus.textContent = "저장 중...";

  const response = await fetch("/api/admin/date", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: Number(saveButton.dataset.id),
      date: select.value
    })
  });

  const data = await response.json();
  if (!response.ok) {
    adminStatus.textContent = data.message || "저장에 실패했습니다.";
    await loadAdminList();
    return;
  }

  select.dataset.originalDate = data.participant.date;
  adminStatus.textContent = "저장되었습니다.";
  select.disabled = false;
  await loadAdminList();
});
